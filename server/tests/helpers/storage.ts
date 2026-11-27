/**
 * A fake file storage (the R2 adapter's interface) for tests: keeps objects in memory,
 * signs "links" that just name the key, and can be told to fail once.
 */
import type { FileStorage } from '../../src/adapters/r2Storage.ts';
import { FileStorageError } from '../../src/adapters/r2Storage.ts';

export function fakeStorage() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const failNext = { put: false, remove: false, get: false };

  const storage: FileStorage = {
    async put({ key, body, contentType }) {
      if (failNext.put) {
        failNext.put = false;
        throw new FileStorageError('File storage failed to store a file');
      }
      objects.set(key, { body, contentType });
    },
    async get(key) {
      if (failNext.get) {
        failNext.get = false;
        throw new FileStorageError('File storage failed to read a file');
      }
      return objects.get(key) ?? null;
    },
    async remove(keys) {
      if (failNext.remove) {
        failNext.remove = false;
        throw new FileStorageError('File storage failed to delete files');
      }
      for (const key of keys) objects.delete(key);
    },
    async signedUrl(key, { expiresInSeconds, downloadName }) {
      const download = downloadName ? `&download=${encodeURIComponent(downloadName)}` : '';
      return `https://storage.test/${key}?expires=${expiresInSeconds}${download}`;
    },
  };
  return { storage, objects, failNext };
}
