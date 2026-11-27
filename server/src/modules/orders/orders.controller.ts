import type { Request, Response } from 'express';
import type { ApiResponse, PaginatedResponse } from '@shared/types/api.ts';
import type { LabelOption, ShippingAddress, ShippingAddressInput } from '@shared/types/shipping.ts';
import type {
  AdminOrder,
  CartLine,
  CartPreview,
  CartShippingQuote,
  CheckoutInput,
  CheckoutStarted,
  Order,
  OrderStatus,
  RefundOrderInput,
} from '@shared/types/order.ts';
import type { AppAdapters } from '../../adapters/index.ts';
import type { GivingSetup } from '../giving/giving.service.ts';
import * as ordersService from './orders.service.ts';
import * as labelsService from '../shipping/shipping.labels.service.ts';
import * as trackingService from '../shipping/shipping.tracking.service.ts';

type User = { id: number; email: string; role: 'client' | 'admin' };

const adapters = (req: Request) => req.app.locals.adapters as AppAdapters;
const shopOpen = (req: Request) => Boolean(req.app.locals.shopOpen);
const orderId = (req: Request) => (req.validated.params as { id: number }).id;
const items = (req: Request) => (req.validated.body as { items: CartLine[] }).items;

export async function preview(req: Request, res: Response) {
  const result = await ordersService.previewCart(req.user as User | undefined, items(req), {
    shopOpen: shopOpen(req),
  });
  res.json({ data: result } satisfies ApiResponse<CartPreview>);
}

export async function shippingOptions(req: Request, res: Response) {
  const { address } = req.validated.body as { address: ShippingAddressInput };
  const quote = await ordersService.shippingOptions(req.user as User, items(req), address, {
    shopOpen: shopOpen(req),
    shipping: adapters(req).shipping,
  });
  res.json({ data: quote } satisfies ApiResponse<CartShippingQuote>);
}

export async function lastAddress(req: Request, res: Response) {
  const address = await ordersService.lastAddress(req.user as User);
  res.json({ data: address } satisfies ApiResponse<ShippingAddress | null>);
}

export async function checkout(req: Request, res: Response) {
  const started = await ordersService.startCheckout(
    req.user as User,
    req.validated.body as CheckoutInput,
    {
      gateway: adapters(req).payments,
      email: adapters(req).email,
      shopOpen: shopOpen(req),
      shipping: adapters(req).shipping,
    },
  );
  res.status(201).json({ data: started } satisfies ApiResponse<CheckoutStarted>);
}

export async function mine(req: Request, res: Response) {
  const result = await ordersService.listMyOrders(
    req.user as User,
    req.validated.query as { page: number; pageSize: number },
  );
  res.json(result satisfies PaginatedResponse<Order>);
}

export async function get(req: Request, res: Response) {
  const order = await ordersService.getOrder(req.user as User, orderId(req));
  res.json({ data: order } satisfies ApiResponse<Order>);
}

export async function adminList(req: Request, res: Response) {
  const result = await ordersService.listAdminOrders(
    req.validated.query as { status?: OrderStatus; page: number; pageSize: number },
  );
  res.json(
    result satisfies PaginatedResponse<
      Omit<AdminOrder, 'events' | 'refunds' | 'refundable' | 'refundableCents' | 'trees'>
    >,
  );
}

export async function adminGet(req: Request, res: Response) {
  const order = await ordersService.getAdminOrder(orderId(req));
  res.json({ data: order } satisfies ApiResponse<AdminOrder>);
}

export async function refund(req: Request, res: Response) {
  const order = await ordersService.refundOrder(
    req.user as User,
    orderId(req),
    req.validated.body as RefundOrderInput,
    { gateway: adapters(req).payments },
  );
  res.json({ data: order } satisfies ApiResponse<AdminOrder>);
}

// --- Shipping an order (admin, milestone 12c) ---

const order = (req: Request) => ({ kind: 'order' as const, id: orderId(req) });
/** Delivering an order records its trees (milestone 12d, ADR 0022). */
const giving = (req: Request) => req.app.locals.giving as GivingSetup;
const sendAdminOrder = async (req: Request, res: Response) =>
  res.json({
    data: await ordersService.getAdminOrder(orderId(req)),
  } satisfies ApiResponse<AdminOrder>);

export async function mark(req: Request, res: Response) {
  const updated = await ordersService.markOrder(
    req.user as User,
    orderId(req),
    (req.validated.body as { toStatus: 'shipped' | 'delivered' }).toStatus,
    { email: adapters(req).email, giving: giving(req) },
  );
  res.json({ data: updated } satisfies ApiResponse<AdminOrder>);
}

export async function labelOptions(req: Request, res: Response) {
  const options = await labelsService.labelOptions(order(req), {
    shipping: adapters(req).shipping,
  });
  res.json({ data: options } satisfies ApiResponse<LabelOption[]>);
}

export async function buyLabel(req: Request, res: Response) {
  await labelsService.buyLabel(order(req), (req.validated.body as { rateId: string }).rateId, {
    shipping: adapters(req).shipping,
  });
  await sendAdminOrder(req, res);
}

/** Sends the browser to a fresh link to the label PDF (the shipping service's links expire). */
export async function labelFile(req: Request, res: Response) {
  const url = await labelsService.labelFileUrl(order(req), { shipping: adapters(req).shipping });
  res.set('Cache-Control', 'no-store');
  res.redirect(302, url);
}

export async function voidLabel(req: Request, res: Response) {
  await labelsService.voidLabel(order(req), { shipping: adapters(req).shipping });
  await sendAdminOrder(req, res);
}

export async function refreshTracking(req: Request, res: Response) {
  await trackingService.refreshOwner(order(req), {
    shipping: adapters(req).shipping,
    email: adapters(req).email,
    giving: giving(req),
  });
  await sendAdminOrder(req, res);
}
