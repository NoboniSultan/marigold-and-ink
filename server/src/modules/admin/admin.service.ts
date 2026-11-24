/**
 * The admin screens' overview of commissions (milestone 9): each commission with its
 * client, and one commission's full picture (details, client, money). It only combines
 * other modules' services, so commissions, users, and payments stay independent.
 */
import type { AdminClient } from '@shared/types/admin.ts';
import * as commissionsService from '../commissions/commissions.service.js';
import * as paymentsService from '../payments/payments.service.ts';
import * as usersService from '../users/users.service.ts';

/** The signed-in admin, as requireAuth put it on req.user. */
type SessionUser = { id: number; role: 'client' | 'admin' };

function toClient(user: { id: number; displayName: string; email: string } | undefined) {
  return user
    ? ({ id: user.id, displayName: user.displayName, email: user.email } satisfies AdminClient)
    : null;
}

export async function listCommissions(
  admin: SessionUser,
  query: { page: number; pageSize: number; status?: string },
) {
  const { commissions, meta } = await commissionsService.listCommissions(admin, {
    page: query.page,
    pageSize: query.pageSize,
    status: query.status,
  });
  const clients = await usersService.findByIds(commissions.map((c) => c!.clientId));
  return {
    commissions: commissions.map((c) => ({ ...c!, client: toClient(clients.get(c!.clientId)) })),
    meta,
  };
}

export async function getCommission(admin: SessionUser, id: number) {
  const commission = await commissionsService.getCommissionDetails(id, admin);
  const [clients, money] = await Promise.all([
    usersService.findByIds([commission.clientId]),
    paymentsService.moneySummary(id),
  ]);
  return { commission, client: toClient(clients.get(commission.clientId)), money };
}
