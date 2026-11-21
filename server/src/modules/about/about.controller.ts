import type { Request, Response } from 'express';
import type { AboutContent } from '@shared/types/about.ts';
import type { ApiResponse } from '@shared/types/api.ts';
import * as aboutService from './about.service.ts';

export async function get(_req: Request, res: Response) {
  res.json({ data: await aboutService.getAbout() } satisfies ApiResponse<AboutContent>);
}
