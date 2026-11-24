import type { Request, Response } from 'express';
import type { ApiResponse } from '@shared/types/api.ts';
import type { CommissionFile, FilesResponse } from '@shared/types/files.ts';
import type { AppAdapters } from '../../adapters/index.ts';
import * as filesService from './files.service.ts';

type User = { id: number; role: 'client' | 'admin' };

const storage = (req: Request) => (req.app.locals.adapters as AppAdapters).storage;
const commissionId = (req: Request) => (req.validated.params as { id: number }).id;

/** The upload is the raw request body (express.raw); its name comes in X-Filename. */
function upload(req: Request): filesService.Upload {
  return {
    data: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
    filename: req.get('X-Filename') ?? undefined,
  };
}

export async function list(req: Request, res: Response) {
  const result = await filesService.listFiles(req.user as User, commissionId(req), {
    storage: storage(req),
  });
  res.json(result satisfies FilesResponse);
}

export async function uploadReference(req: Request, res: Response) {
  const file = await filesService.uploadReference(
    req.user as User,
    commissionId(req),
    upload(req),
    {
      storage: storage(req),
    },
  );
  res.status(201).json({ data: file } satisfies ApiResponse<CommissionFile>);
}

export async function uploadPreview(req: Request, res: Response) {
  const file = await filesService.uploadPreview(req.user as User, commissionId(req), upload(req), {
    storage: storage(req),
  });
  res.status(201).json({ data: file } satisfies ApiResponse<CommissionFile>);
}

export async function uploadFinal(req: Request, res: Response) {
  const file = await filesService.uploadFinal(req.user as User, commissionId(req), upload(req), {
    storage: storage(req),
  });
  res.status(201).json({ data: file } satisfies ApiResponse<CommissionFile>);
}

export async function remove(req: Request, res: Response) {
  const { id, fileId } = req.validated.params as { id: number; fileId: number };
  await filesService.deleteFile(req.user as User, id, fileId, { storage: storage(req) });
  res.status(204).end();
}
