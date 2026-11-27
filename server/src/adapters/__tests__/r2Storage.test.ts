/** The real R2 adapter with a fake S3 client: no request ever leaves the machine. */
import { describe, it, expect } from 'vitest';
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { FileStorageError, attachmentHeader, createR2Storage } from '../r2Storage.ts';

const settings = {
  accountId: '0123456789abcdef0123456789abcdef',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret',
  bucket: 'marigold-files',
};

function withFakeClient(fail = false) {
  const sent: unknown[] = [];
  const storage = createR2Storage({
    ...settings,
    client: {
      send: (async (command: unknown) => {
        if (fail) throw new Error('network down');
        sent.push(command);
        return {};
      }) as never,
    },
  });
  return { storage, sent };
}

describe('createR2Storage', () => {
  it('stores an object in the bucket with its content type', async () => {
    const { storage, sent } = withFakeClient();
    await storage.put({ key: 'a/b.jpg', body: Buffer.from('x'), contentType: 'image/jpeg' });

    const command = sent[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'marigold-files',
      Key: 'a/b.jpg',
      ContentType: 'image/jpeg',
    });
  });

  it('deletes in batches of at most 1,000, and does nothing for none', async () => {
    const { storage, sent } = withFakeClient();
    await storage.remove([]);
    expect(sent).toEqual([]);

    await storage.remove(Array.from({ length: 1001 }, (_, i) => `k${i}`));
    expect(sent).toHaveLength(2);
    expect((sent[0] as DeleteObjectsCommand).input.Delete!.Objects).toHaveLength(1000);
    expect((sent[1] as DeleteObjectsCommand).input.Delete!.Objects).toEqual([{ Key: 'k1000' }]);
  });

  it('signs a short-lived link on the account endpoint, with a download name when asked', async () => {
    const { storage } = withFakeClient();
    const view = new URL(await storage.signedUrl('a/b.jpg', { expiresInSeconds: 600 }));
    expect(view.host).toBe(`marigold-files.${settings.accountId}.r2.cloudflarestorage.com`);
    expect(view.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(view.searchParams.get('response-content-disposition')).toBeNull();

    const download = new URL(
      await storage.signedUrl('a/b.pdf', { expiresInSeconds: 60, downloadName: 'Benito.pdf' }),
    );
    expect(download.searchParams.get('response-content-disposition')).toBe(
      attachmentHeader('Benito.pdf'),
    );
  });

  it('reads an object, and answers null for a missing one', async () => {
    const sent: unknown[] = [];
    const storage = createR2Storage({
      ...settings,
      client: {
        send: (async (command: GetObjectCommand) => {
          sent.push(command);
          if (command.input.Key === 'missing') {
            throw Object.assign(new Error('gone'), { name: 'NoSuchKey' });
          }
          if (command.input.Key === 'broken') throw new Error('network down');
          return {
            ContentType: 'image/webp',
            Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
          };
        }) as never,
      },
    });

    await expect(storage.get('a/b.webp')).resolves.toEqual({
      body: Buffer.from([1, 2, 3]),
      contentType: 'image/webp',
    });
    expect((sent[0] as GetObjectCommand).input).toEqual({
      Bucket: 'marigold-files',
      Key: 'a/b.webp',
    });
    await expect(storage.get('missing')).resolves.toBeNull();
    await expect(storage.get('broken')).rejects.toBeInstanceOf(FileStorageError);
  });

  it('reports a storage failure as FileStorageError', async () => {
    const { storage } = withFakeClient(true);
    await expect(
      storage.put({ key: 'k', body: Buffer.from('x'), contentType: 'image/png' }),
    ).rejects.toBeInstanceOf(FileStorageError);
    await expect(storage.remove(['k'])).rejects.toBeInstanceOf(FileStorageError);
  });
});

describe('attachmentHeader', () => {
  it('gives an ASCII name and the full UTF-8 one', () => {
    expect(attachmentHeader('Bénito "1".pdf')).toBe(
      `attachment; filename="B_nito _1_.pdf"; filename*=UTF-8''B%C3%A9nito%20%221%22.pdf`,
    );
  });
});
