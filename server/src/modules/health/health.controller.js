import * as healthService from './health.service.js';

export async function getHealth(_req, res) {
  const health = await healthService.getHealth();
  res.set('Cache-Control', 'no-store').json({ data: health });
}
