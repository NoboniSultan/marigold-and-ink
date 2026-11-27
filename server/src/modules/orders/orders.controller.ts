import type { Request, Response } from 'express';
import type { ApiResponse, PaginatedResponse } from '@shared/types/api.ts';
import type {
  AdminOrder,
  CartLine,
  CartPreview,
  CheckoutStarted,
  Order,
  OrderStatus,
  RefundOrderInput,
} from '@shared/types/order.ts';
import type { AppAdapters } from '../../adapters/index.ts';
import * as ordersService from './orders.service.ts';

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

export async function checkout(req: Request, res: Response) {
  const started = await ordersService.startCheckout(req.user as User, items(req), {
    gateway: adapters(req).payments,
    email: adapters(req).email,
    shopOpen: shopOpen(req),
  });
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
    result satisfies PaginatedResponse<Omit<AdminOrder, 'events' | 'refunds' | 'refundable'>>,
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
