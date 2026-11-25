/**
 * A commission's files (milestone 10, ADR 0016):
 * - reference photos, from the client (or the admin), until work starts;
 * - previews, from the admin, watermarked before they're stored;
 * - final files, from the admin, downloadable by the client once paid in full.
 *
 * The bytes live in private storage (the `storage` adapter); the files table records them.
 * Reads are signed links that expire in minutes. An expiry sweep deletes files once the
 * owner's keeping periods are over (files.rules.ts).
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { CommissionFile, FilesMeta } from '@shared/types/files.ts';
import type { FileStorage } from '../../adapters/r2Storage.ts';
import { withTransaction } from '../../db/transaction.ts';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../../errors/index.js';
import { logger } from '../../lib/logger.js';
import * as commissionsService from '../commissions/commissions.service.js';
import * as filesRepository from './files.repository.ts';
import type { FileRecord } from './files.repository.ts';
import {
  NotAnImageError,
  cleanFilename,
  detectType,
  processPreview,
  processReference,
  type ProcessedImage,
} from './files.processing.ts';
import {
  ALLOWED_TYPES,
  EXTENSIONS,
  FINAL_MAX_BYTES,
  LINK_SECONDS,
  PAID_IN_FULL_STATUSES,
  PREVIEW_MAX_BYTES,
  REFERENCE_LIMIT,
  REFERENCE_MAX_BYTES,
  acceptsDeliverables,
  deleteAfter,
  referencesOpen,
  type FileKind,
} from './files.rules.ts';

interface SessionUser {
  id: number;
  role: 'client' | 'admin';
}

export interface Upload {
  data: Buffer;
  /** The name the browser sent (X-Filename), URI-encoded. */
  filename?: string;
}

function requireStorage(storage: FileStorage | null | undefined): FileStorage {
  if (!storage) {
    throw new ServiceUnavailableError("File uploads aren't available yet.", {
      code: 'FILES_UNAVAILABLE',
    });
  }
  return storage;
}

const LABELS: Record<FileKind, string> = {
  reference: 'reference photo',
  preview: 'preview',
  final: 'final file',
};

/** The file's real type, checked against what this kind of upload allows. */
function checkType(kind: FileKind, data: Buffer) {
  if (data.length === 0) {
    throw new ValidationError('Send the file as the request body', { code: 'FILE_REQUIRED' });
  }
  const type = detectType(data);
  if (!type || !ALLOWED_TYPES[kind].includes(type)) {
    const allowed = ALLOWED_TYPES[kind].map((t) => EXTENSIONS[t].toUpperCase()).join(', ');
    throw new ValidationError(`A ${LABELS[kind]} must be one of: ${allowed}`, {
      code: 'UNSUPPORTED_FILE_TYPE',
      details: { allowed: ALLOWED_TYPES[kind] },
    });
  }
  return type;
}

async function processImage(process: (data: Buffer) => Promise<ProcessedImage>, data: Buffer) {
  try {
    return await process(data);
  } catch (err) {
    if (err instanceof NotAnImageError) {
      throw new ValidationError("That file couldn't be read as an image", {
        code: 'NOT_AN_IMAGE',
      });
    }
    throw err;
  }
}

/**
 * Stores the bytes, then records the row in a transaction that can still refuse it (for
 * example an 11th reference photo, checked under the commission's lock so two uploads at
 * once can't both slip in). If the row is refused, the stored object is removed again.
 */
async function store(
  storage: FileStorage,
  file: Omit<FileRecord, 'id' | 'createdAt' | 'storageKey'>,
  data: Buffer,
  check: (tx: PoolClient) => Promise<void>,
): Promise<FileRecord> {
  const ext = EXTENSIONS[file.contentType as keyof typeof EXTENSIONS];
  const storageKey = `commissions/${file.commissionId}/${file.kind}/${randomUUID()}.${ext}`;
  await storage.put({ key: storageKey, body: data, contentType: file.contentType });
  try {
    return await withTransaction(async (tx) => {
      await commissionsService.lockCommission(file.commissionId, tx);
      await check(tx);
      return filesRepository.insertFile({ ...file, storageKey }, tx);
    });
  } catch (err) {
    await storage.remove([storageKey]).catch((removeErr) => {
      logger.warn({ err: removeErr, storageKey }, 'could not remove a refused upload');
    });
    throw err;
  }
}

/** A reference photo: the commission's client (or the admin), until work starts. */
export async function uploadReference(
  user: SessionUser,
  commissionId: number,
  upload: Upload,
  { storage }: { storage?: FileStorage | null },
) {
  const store_ = requireStorage(storage);
  const commission = await commissionsService.getCommissionForUser(commissionId, user);
  if (!referencesOpen(commission.status)) {
    throw new ConflictError('Reference photos can only be added before work starts', {
      code: 'REFERENCES_CLOSED',
    });
  }
  if (upload.data.length > REFERENCE_MAX_BYTES) {
    throw new ValidationError('A reference photo can be at most 15 MB', { code: 'FILE_TOO_LARGE' });
  }
  checkType('reference', upload.data);
  const image = await processImage(processReference, upload.data);
  const record = await store(
    store_,
    {
      commissionId,
      uploadedByUserId: user.id,
      kind: 'reference',
      originalFilename: cleanFilename(upload.filename, 'reference.jpg'),
      contentType: 'image/jpeg',
      sizeBytes: image.data.length,
      width: image.width,
      height: image.height,
    },
    image.data,
    async (tx) => {
      if ((await filesRepository.countKind(commissionId, 'reference', tx)) >= REFERENCE_LIMIT) {
        throw new BusinessRuleError(
          `A commission can have at most ${REFERENCE_LIMIT} reference photos`,
          { code: 'REFERENCE_LIMIT', details: { limit: REFERENCE_LIMIT } },
        );
      }
    },
  );
  return toView(record, store_, null);
}

async function requireDeliverableStage(admin: SessionUser, commissionId: number) {
  const commission = await commissionsService.getCommissionForUser(commissionId, admin);
  if (!acceptsDeliverables(commission.status)) {
    throw new ConflictError('Previews and final files come after the deposit is paid', {
      code: 'COMMISSION_NOT_STARTED',
      details: { status: commission.status },
    });
  }
}

/** A preview (admin): watermarked before it's stored, so no clean copy ever leaves. */
export async function uploadPreview(
  admin: SessionUser,
  commissionId: number,
  upload: Upload,
  { storage }: { storage?: FileStorage | null },
) {
  const store_ = requireStorage(storage);
  await requireDeliverableStage(admin, commissionId);
  if (upload.data.length > PREVIEW_MAX_BYTES) {
    throw new ValidationError('A preview can be at most 25 MB', { code: 'FILE_TOO_LARGE' });
  }
  checkType('preview', upload.data);
  const image = await processImage(processPreview, upload.data);
  const record = await store(
    store_,
    {
      commissionId,
      uploadedByUserId: admin.id,
      kind: 'preview',
      originalFilename: cleanFilename(upload.filename, 'preview.jpg'),
      contentType: 'image/jpeg',
      sizeBytes: image.data.length,
      width: image.width,
      height: image.height,
    },
    image.data,
    async () => {},
  );
  return toView(record, store_, null);
}

/** A final file (admin): stored exactly as uploaded; the client downloads it once paid. */
export async function uploadFinal(
  admin: SessionUser,
  commissionId: number,
  upload: Upload,
  { storage }: { storage?: FileStorage | null },
) {
  const store_ = requireStorage(storage);
  await requireDeliverableStage(admin, commissionId);
  if (upload.data.length > FINAL_MAX_BYTES) {
    throw new ValidationError('A final file can be at most 100 MB', { code: 'FILE_TOO_LARGE' });
  }
  const type = checkType('final', upload.data);
  const record = await store(
    store_,
    {
      commissionId,
      uploadedByUserId: admin.id,
      kind: 'final',
      originalFilename: cleanFilename(upload.filename, `artwork.${EXTENSIONS[type]}`),
      contentType: type,
      sizeBytes: upload.data.length,
      width: null,
      height: null,
    },
    upload.data,
    async () => {},
  );
  return toView(record, store_, null);
}

/** Signed links for one file: inline for images, and a download under its own name. */
async function toView(
  file: FileRecord,
  storage: FileStorage,
  deletesAt: Date | null,
): Promise<CommissionFile> {
  const isImage = file.contentType.startsWith('image/') && file.contentType !== 'image/tiff';
  const [url, downloadUrl] = await Promise.all([
    isImage ? storage.signedUrl(file.storageKey, { expiresInSeconds: LINK_SECONDS }) : null,
    storage.signedUrl(file.storageKey, {
      expiresInSeconds: LINK_SECONDS,
      downloadName: file.originalFilename ?? `${file.kind}.${file.storageKey.split('.').pop()}`,
    }),
  ]);
  return {
    id: file.id,
    kind: file.kind,
    originalFilename: file.originalFilename,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    width: file.width,
    height: file.height,
    createdAt: file.createdAt.toISOString(),
    url,
    downloadUrl,
    deleteAfter: deletesAt?.toISOString() ?? null,
  };
}

/**
 * A commission's files for its client or the admin. The client sees reference photos and
 * previews always, and final files only once the commission is paid in full.
 */
export async function listFiles(
  user: SessionUser,
  commissionId: number,
  { storage }: { storage?: FileStorage | null },
): Promise<{ data: CommissionFile[]; meta: FilesMeta }> {
  const commission = await commissionsService.getCommissionForUser(commissionId, user);
  const meta: FilesMeta = {
    filesEnabled: Boolean(storage),
    referencesOpen: referencesOpen(commission.status),
    referenceLimit: REFERENCE_LIMIT,
    referenceMaxBytes: REFERENCE_MAX_BYTES,
    previewMaxBytes: PREVIEW_MAX_BYTES,
    finalMaxBytes: FINAL_MAX_BYTES,
  };
  if (!storage) return { data: [], meta };

  const paidInFull = PAID_IN_FULL_STATUSES.includes(commission.status);
  const visible = (await filesRepository.listForCommission(commissionId)).filter(
    (file) => user.role === 'admin' || file.kind !== 'final' || paidInFull,
  );
  const times = (await commissionsService.milestoneTimes([commissionId])).get(commissionId);
  const data = await Promise.all(
    visible.map((file) => toView(file, storage, times ? deleteAfter(file.kind, times) : null)),
  );
  return { data, meta };
}

/**
 * Removes a file. The admin may remove any; the client only their commission's reference
 * photos, and only until work starts.
 */
export async function deleteFile(
  user: SessionUser,
  commissionId: number,
  fileId: number,
  { storage }: { storage?: FileStorage | null },
) {
  const store_ = requireStorage(storage);
  const commission = await commissionsService.getCommissionForUser(commissionId, user);
  const file = await filesRepository.findById(fileId);
  if (!file || file.commissionId !== commissionId) {
    throw new NotFoundError('File not found', { code: 'FILE_NOT_FOUND' });
  }
  if (user.role !== 'admin') {
    if (file.kind !== 'reference') {
      throw new ForbiddenError('Only the artist can remove previews and final files', {
        code: 'FILE_FORBIDDEN',
      });
    }
    if (!referencesOpen(commission.status)) {
      throw new ConflictError('Reference photos can only be changed before work starts', {
        code: 'REFERENCES_CLOSED',
      });
    }
  }
  // Storage first: if that fails, the row stays and the removal can be tried again.
  await store_.remove([file.storageKey]);
  await filesRepository.deleteByIds([file.id]);
}

/**
 * Account deletion: removes the client's reference photos from the table inside the
 * deletion's transaction. Returns their storage keys, for the caller to remove from storage
 * once the deletion has committed.
 */
export function takeReferencesForDeletedClient(userId: number, { client }: { client: PoolClient }) {
  return filesRepository.deleteReferencesUploadedBy(userId, client);
}

/** Removes objects after a deletion has committed. Never throws: leftovers are logged. */
export async function removeStoredObjects(storage: FileStorage | null | undefined, keys: string[]) {
  if (!storage || keys.length === 0) return;
  try {
    await storage.remove(keys);
  } catch (err) {
    logger.error({ err, count: keys.length }, 'could not remove deleted files from storage');
  }
}

/**
 * The expiry sweep (ADR 0016): deletes every file whose keeping period is over. Runs at
 * startup and once a day. Never throws; returns how many files it deleted.
 */
export async function purgeExpiredFiles(
  storage: FileStorage | null | undefined,
  now = new Date(),
): Promise<number> {
  if (!storage) return 0;
  try {
    const files = await filesRepository.listForSweep();
    const times = await commissionsService.milestoneTimes(files.map((f) => f.commissionId));
    const expired = files.filter((file) => {
      const t = times.get(file.commissionId);
      const at = t ? deleteAfter(file.kind, t) : null;
      return at !== null && at <= now;
    });
    if (expired.length === 0) return 0;
    // Storage first: a file whose bytes couldn't be removed keeps its row for next time.
    await storage.remove(expired.map((f) => f.storageKey));
    await filesRepository.deleteByIds(expired.map((f) => f.id));
    logger.info({ count: expired.length }, 'expired files deleted');
    return expired.length;
  } catch (err) {
    logger.error({ err }, 'the expired-files sweep failed; it will run again later');
    return 0;
  }
}
