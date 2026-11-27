import type { Request, Response } from 'express';
import type { ApiResponse } from '@shared/types/api.ts';
import type {
  Shipment,
  ShippingAddressInput,
  ShippingOption,
  ShippingPackage,
  ShippingResponse,
} from '@shared/types/shipping.ts';
import type { AppAdapters } from '../../adapters/index.ts';
import * as shippingService from './shipping.service.ts';

type User = { id: number; role: 'client' | 'admin' };

const shipping = (req: Request) => ({
  shipping: (req.app.locals.adapters as AppAdapters).shipping,
});
const commissionId = (req: Request) => (req.validated.params as { id: number }).id;

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
