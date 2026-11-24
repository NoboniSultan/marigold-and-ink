import type { Request, Response } from 'express';
import * as adminService from './admin.service.ts';

type Admin = { id: number; role: 'client' | 'admin' };

/** Commissions with their clients, newest first; ?status= to filter. */
export async function listCommissions(req: Request, res: Response) {
  const { commissions, meta } = await adminService.listCommissions(
    req.user as Admin,
    req.validated.query as { page: number; pageSize: number; status?: string },
  );
  res.json({ data: commissions, meta });
}

/** One commission: details and allowed moves, the client, and where its money stands. */
export async function getCommission(req: Request, res: Response) {
  const { id } = req.validated.params as { id: number };
  res.json({ data: await adminService.getCommission(req.user as Admin, id) });
}
