/**
 * Private file storage in a Cloudflare R2 bucket (milestone 10, ADR 0016): the only code
 * that talks to it. R2 speaks the S3 API, so this uses AWS's S3 client pointed at R2.
 *
 * The bucket is never public. Files are read only through signed URLs that expire within
 * minutes, created here for one file at a time, so a link that leaks stops working soon.
 */
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface FileStorage {
  put(input: { key: string; body: Buffer; contentType: string }): Promise<void>;
  /**
   * Reads one object, or null if it doesn't exist. Used for public shop photos, which the
   * site serves itself (the bucket stays private).
   */
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  /** Deletes the given objects; missing ones are not an error. */
  remove(keys: string[]): Promise<void>;
  /**
   * A URL that reads one object for `expiresInSeconds`. With `downloadName`, browsers
   * save it under that name instead of showing it.
   */
  signedUrl(
    key: string,
    options: { expiresInSeconds: number; downloadName?: string },
  ): Promise<string>;
}

export class FileStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FileStorageError';
  }
}

/** S3 deletes at most 1,000 objects per request. */
const DELETE_BATCH = 1000;

/** `attachment; filename=…` with an ASCII fallback and the full UTF-8 name (RFC 6266). */
export function attachmentHeader(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Just what this adapter needs from S3Client, so tests can pass a fake. */
type S3Like = Pick<S3Client, 'send'>;

export function createR2Storage({
  accountId,
  accessKeyId,
  secretAccessKey,
  bucket,
  client,
}: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  client?: S3Like;
}): FileStorage {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  const sender: S3Like = client ?? s3;

  async function call<T>(what: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw new FileStorageError(`File storage failed to ${what}`, { cause: err });
    }
  }

  return {
    put({ key, body, contentType }) {
      return call('store a file', async () => {
        await sender.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
        );
      });
    },

    async get(key) {
      try {
        const answer = await sender.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const bytes = await answer.Body!.transformToByteArray();
        return {
          body: Buffer.from(bytes),
          contentType: answer.ContentType ?? 'application/octet-stream',
        };
      } catch (err) {
        if ((err as { name?: string }).name === 'NoSuchKey') return null;
        throw new FileStorageError('File storage failed to read a file', { cause: err });
      }
    },

    async remove(keys) {
      for (let i = 0; i < keys.length; i += DELETE_BATCH) {
        const batch = keys.slice(i, i + DELETE_BATCH);
        await call('delete files', () =>
          sender.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
            }),
          ),
        );
      }
    },

    signedUrl(key, { expiresInSeconds, downloadName }) {
      // Signing happens locally (no network), with the real client's credentials.
      return call('sign a link', () =>
        getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            ...(downloadName ? { ResponseContentDisposition: attachmentHeader(downloadName) } : {}),
          }),
          { expiresIn: expiresInSeconds },
        ),
      );
    },
  };
}
