import type { Request, Response } from 'express';
import type { ApiResponse } from '@shared/types/api.ts';
import type {
  LabelOption,
  Shipment,
  ShippingAddressInput,
  ShippingOption,
  ShippingPackage,
  ShippingResponse,
} from '@shared/types/shipping.ts';
import type { AppAdapters } from '../../adapters/index.ts';
import * as shippingService from './shipping.service.ts';
import * as labelsService from './shipping.labels.service.ts';
import * as trackingService from './shipping.tracking.service.ts';

type User = { id: number; role: 'client' | 'admin' };

const shipping = (req: Request) => ({
  shipping: (req.app.locals.adapters as AppAdapters).shipping,
});
const shippingAndEmail = (req: Request) => {
  const adapters = req.app.locals.adapters as AppAdapters;
  return { shipping: adapters.shipping, email: adapters.email };
};
const commissionId = (req: Request) => (req.validated.params as { id: number }).id;
/** Label and tracking actions on these routes are for the commission in the URL. */
const owner = (req: Request) => ({ kind: 'commission' as const, id: commissionId(req) });

/** After a label change, the admin gets the whole shipment back (as GET would answer). */
async function sendShipping(req: Request, res: Response) {
  const result = await shippingService.getShipping(
    req.user as User,
    commissionId(req),
    shipping(req),
  );
  res.json(result satisfies ShippingResponse);
}

export async function get(req: Request, res: Response) {
  const result = await shippingService.getShipping(
    req.user as User,
    commissionId(req),
    shipping(req),
  );
  res.json(result satisfies ShippingResponse);
}

export async function setAddress(req: Request, res: Response) {
  const shipment = await shippingService.setAddress(
    req.user as User,
    commissionId(req),
    req.validated.body as ShippingAddressInput,
    shipping(req),
  );
  res.json({ data: shipment } satisfies ApiResponse<Shipment>);
}

export async function setPackage(req: Request, res: Response) {
  const shipment = await shippingService.setPackage(
    commissionId(req),
    req.validated.body as ShippingPackage,
    shipping(req),
  );
  res.json({ data: shipment } satisfies ApiResponse<Shipment>);
}

export async function quote(req: Request, res: Response) {
  const options = await shippingService.quoteOptions(
    req.user as User,
    commissionId(req),
    shipping(req),
  );
  res.json({ data: options } satisfies ApiResponse<ShippingOption[]>);
}

export async function choose(req: Request, res: Response) {
  const shipment = await shippingService.chooseOption(
    req.user as User,
    commissionId(req),
    (req.validated.body as { rateId: string }).rateId,
    shipping(req),
  );
  res.json({ data: shipment } satisfies ApiResponse<Shipment>);
}

// --- Labels and tracking (admin, milestone 11b) ---

export async function labelOptions(req: Request, res: Response) {
  const options = await labelsService.labelOptions(owner(req), shipping(req));
  res.json({ data: options } satisfies ApiResponse<LabelOption[]>);
}

export async function buyLabel(req: Request, res: Response) {
  await labelsService.buyLabel(
    owner(req),
    (req.validated.body as { rateId: string }).rateId,
    shipping(req),
  );
  await sendShipping(req, res);
}

/** Sends the browser to a fresh link to the label PDF (the shipping service's links expire). */
export async function labelFile(req: Request, res: Response) {
  const url = await labelsService.labelFileUrl(owner(req), shipping(req));
  res.set('Cache-Control', 'no-store');
  res.redirect(302, url);
}

export async function voidLabel(req: Request, res: Response) {
  await labelsService.voidLabel(owner(req), shipping(req));
  await sendShipping(req, res);
}

export async function refreshTracking(req: Request, res: Response) {
  await trackingService.refreshOwner(owner(req), shippingAndEmail(req));
  await sendShipping(req, res);
}

/** Shippo's tracking webhook (the link's secret was checked before this). */
export async function webhook(req: Request, res: Response) {
  const result = await trackingService.handleWebhook(
    req.validated.body as { event: string; data?: { tracking_number?: string } | null },
    shippingAndEmail(req),
  );
  res.json({ data: result } satisfies ApiResponse<{ handled: boolean }>);
}
