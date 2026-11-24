/**
 * SQL for the files table (milestone 10). Every function accepts an optional `client` so
 * the service can group calls in a transaction.
 */
import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import type { FileKind } from './files.rules.ts';

type Db = Pool | PoolClient;

export interface FileRecord {
  id: number;
  commissionId: number;
  uploadedByUserId: number;
  kind: FileKind;
  storageKey: string;
  originalFilename: string | null;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
}

const COLUMNS = `id, commission_id, uploaded_by_user_id, kind, storage_key, original_filename,
  content_type, size_bytes, width, height, created_at`;

function toFile(row: Record<string, unknown>): FileRecord {
  return {
    id: Number(row.id),
    commissionId: Number(row.commission_id),
    uploadedByUserId: Number(row.uploaded_by_user_id),
    kind: row.kind as FileKind,
    storageKey: row.storage_key as string,
    originalFilename: row.original_filename as string | null,
    contentType: row.content_type as string,
    sizeBytes: Number(row.size_bytes),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    createdAt: row.created_at as Date,
  };
}

export async function insertFile(
  file: Omit<FileRecord, 'id' | 'createdAt'>,
  client: Db = pool,
): Promise<FileRecord> {
  const { rows } = await client.query(
    `INSERT INTO files (commission_id, uploaded_by_user_id, kind, storage_key, original_filename,
                        content_type, size_bytes, width, height)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${COLUMNS}`,
    [
      file.commissionId,
      file.uploadedByUserId,
      file.kind,
      file.storageKey,
      file.originalFilename,
      file.contentType,
      file.sizeBytes,
      file.width,
      file.height,
    ],
  );
  return toFile(rows[0]);
}

/** A commission's files, oldest first (the order they were added). */
export async function listForCommission(commissionId: number, client: Db = pool) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM files WHERE commission_id = $1 ORDER BY created_at, id`,
    [commissionId],
  );
  return rows.map(toFile);
}

export async function findById(id: number, client: Db = pool): Promise<FileRecord | null> {
  const { rows } = await client.query(`SELECT ${COLUMNS} FROM files WHERE id = $1`, [id]);
  return rows[0] ? toFile(rows[0]) : null;
}

export async function countKind(commissionId: number, kind: FileKind, client: Db = pool) {
  const { rows } = await client.query(
    'SELECT count(*)::int AS n FROM files WHERE commission_id = $1 AND kind = $2',
    [commissionId, kind],
  );
  return rows[0].n as number;
}

/** Deletes rows and returns their storage keys. */
export async function deleteByIds(ids: number[], client: Db = pool): Promise<string[]> {
  if (ids.length === 0) return [];
  const { rows } = await client.query(
    'DELETE FROM files WHERE id = ANY($1::bigint[]) RETURNING storage_key',
    [ids],
  );
  return rows.map((row) => row.storage_key as string);
}

/** Every file's ID, commission, kind, and key: what the expiry sweep needs. */
export async function listForSweep(client: Db = pool) {
  const { rows } = await client.query(
    'SELECT id, commission_id, kind, storage_key FROM files ORDER BY id',
  );
  return rows.map((row) => ({
    id: Number(row.id),
    commissionId: Number(row.commission_id),
    kind: row.kind as FileKind,
    storageKey: row.storage_key as string,
  }));
}

/** Account deletion: the reference photos this user uploaded. Returns their storage keys. */
export async function deleteReferencesUploadedBy(userId: number, client: Db = pool) {
  const { rows } = await client.query(
    `DELETE FROM files WHERE uploaded_by_user_id = $1 AND kind = 'reference'
     RETURNING storage_key`,
    [userId],
  );
  return rows.map((row) => row.storage_key as string);
}
