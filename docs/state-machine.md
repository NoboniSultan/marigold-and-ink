# Commission state machine

Every commission moves through a fixed set of statuses. Allowed changes are defined in one pure module, [`commissions.stateMachine.ts`](../server/src/modules/commissions/commissions.stateMachine.ts), which has no database or HTTP access. The service applies a change by updating the commission and inserting a `commission_events` row **in the same database transaction**, so the status and its audit trail can never disagree.

## Diagram

```mermaid
stateDiagram-v2
    [*] --> inquiry: client submits request

    inquiry --> quoted: admin sends quote (quote flow)
    inquiry --> canceled: client or admin

    quoted --> deposit_paid: system (Stripe deposit)
    quoted --> canceled: client or admin

    deposit_paid --> in_progress: admin
    deposit_paid --> refunded: admin or system (refund flow)

    in_progress --> revision: client (revisions left)
    in_progress --> awaiting_final_payment: client approves, or admin
    in_progress --> refunded: admin or system (refund flow)

    revision --> in_progress: admin (uses one revision)

    awaiting_final_payment --> ready_to_ship: system (physical)
    awaiting_final_payment --> delivered: system (digital, mixed media)
    awaiting_final_payment --> refunded: admin or system (refund flow)

    ready_to_ship --> shipped: admin, system
    shipped --> delivered: admin, system
    delivered --> completed: admin

    completed --> [*]
    canceled --> [*]
    refunded --> [*]
```

## Transition table

"Client" means the commission's **own** client. "System" means an automatic actor with no user, such as the Stripe webhook.

| From | To | Who | Rule |
| --- | --- | --- | --- |
| inquiry | quoted | admin | Only through **send quote**, which also records the price |
| inquiry | canceled | client, admin | |
| quoted | canceled | client, admin | |
| quoted | deposit_paid | system | The Stripe webhook: the deposit was paid |
| deposit_paid | in_progress | admin | |
| deposit_paid | refunded | admin, system | Only through the **refund flow**, once everything paid is refunded |
| in_progress | revision | client | Only while `revision_count < revision_limit` |
| in_progress | awaiting_final_payment | client, admin | The client approves the final design (or the admin moves it on) |
| in_progress | refunded | admin, system | Only through the refund flow |
| revision | in_progress | admin | `revision_count` increases by 1 |
| awaiting_final_payment | ready_to_ship | system | Physical only; the Stripe webhook: the balance (with shipping, milestone 11) was paid |
| awaiting_final_payment | delivered | system | Digital and mixed media (delivered as files, owner decision 2026-11-25); the Stripe webhook: the balance was paid |
| awaiting_final_payment | refunded | admin, system | Only through the refund flow |
| ready_to_ship | shipped | admin, system | The system: the carrier's first scan (tracking, milestone 11b). The admin can also mark it |
| shipped | delivered | admin, system | The system: the carrier reports it delivered. If that's the first news, the commission goes through `shipped` first |
| delivered | completed | admin | |
| completed, canceled, refunded | — | — | Terminal: no further changes |

## Errors

A rejected change returns one of three errors, so the client can tell *why* it failed:

| Status | Code | Meaning | Example |
| --- | --- | --- | --- |
| 409 | `COMMISSION_INVALID_TRANSITION` | The move doesn't exist for this commission | `inquiry → shipped`; shipping digital-only work; any move out of a terminal status; using the generic endpoint for `→ quoted` |
| 403 | `COMMISSION_TRANSITION_FORBIDDEN` | The move exists, but not for this actor | A client trying `deposit_paid → in_progress`; a client acting on someone else's commission |
| 422 | `REVISION_LIMIT_REACHED` | A business rule blocks it | Requesting a third revision when the limit is 2 |

## Design notes

- **Data, not if/else chains.** Transitions are a list of `{ from, to, actors, guard?, effect?, via? }`. Adding a status is a data change, and the full rule set can be read and tested in one place.
- **Dedicated flows (`via`).** `→ quoted` and `→ refunded` must do more than change the status: record the price, or move money. The generic status endpoint can't trigger them. Only the quote flow and the refund flow can. A refund changes the status only when everything paid has been refunded; partial refunds, and refunds after the final payment, move money only (see [ADR 0011](decisions/0011-stripe-payments.md)).
- **Concurrency.** The service locks the commission row (`SELECT ... FOR UPDATE`) inside the transaction before checking the rules. If two requests try to change the same commission at once, the second waits and then sees the first one's result, so it can't act on a status that's already out of date.
- **Defense in depth.** The database independently refuses invalid status values, shipping states for digital work, revision counts above the limit, and any edit or deletion of an event row (see [data-model.md](data-model.md)).
- **Tests.** The unit tests check all 144 status pairs against all three actor types, using an expected table written independently of the implementation. A deliberate mutation (letting clients start work) is caught by the suite.

## Shop orders (milestone 12b)

Shop orders have their own, smaller lifecycle (`server/src/modules/orders/orders.stateMachine.ts`, [ADR 0020](decisions/0020-shop-cart-and-checkout.md)). Each change is logged in `order_events`.

```mermaid
stateDiagram-v2
    [*] --> pending_payment: checkout (stock held)
    pending_payment --> paid: system (Stripe)
    pending_payment --> expired: system (page closed; stock released)
    pending_payment --> canceled: client (new checkout), system (account deleted)
    paid --> refunded: admin, system (Dashboard refund)
    expired --> [*]
    canceled --> [*]
    refunded --> [*]
```

| From | To | Who | Notes |
| --- | --- | --- | --- |
| pending_payment | paid | system | Stripe's webhook, or the sweep after asking Stripe |
| pending_payment | expired | system | The 30-minute payment page closed unpaid; the items go back on sale |
| pending_payment | canceled | client, system | The client started a new checkout, or deleted their account; the items go back on sale |
| paid | refunded | admin, system | Once refunds cover the whole order; items go back on sale if the admin asked |

409 `ORDER_INVALID_TRANSITION` for a move that doesn't exist, 403 `ORDER_TRANSITION_FORBIDDEN` for the wrong actor. 12c will add shipping (`paid → shipped → delivered`).
