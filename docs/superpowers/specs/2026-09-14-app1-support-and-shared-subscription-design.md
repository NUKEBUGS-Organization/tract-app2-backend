# App1 Support Tickets + Shared PayPal Subscription Design

**Date:** 2026-09-14  
**Status:** Approved for planning  
**Scope:** Port App2 support-ticket UX into App1; bring App1 onto the same monthly PayPal SaaS subscription as App2 (shared Mongo). No App1 deal/platform % fee.

---

## 1. Goals

1. **Support:** App1 gets the same ticket system as App2 (create, list, thread, reply, admin claim/status), not FAQ-only.
2. **Subscription:** App1 uses the same monthly SaaS fees and entitlement as App2.
3. **Cross-app:** Paying in either app updates status for both (one shared subscription row per user).
4. **App1 fees:** Subscription only. No one-time 0.75% (or other) deal platform fee in App1.

## 2. Decisions (locked)

| Topic | Choice |
|-------|--------|
| Pricing | Same as App2: wholesaler **$50/mo**, realtor (and App2 buyer) **$100/mo**, seller/admin **not required** |
| Sync | **Shared Mongo** `app2_subscriptions` (both apps read/write) |
| App1 gates | Mirror App2: **10 free lifetime partner bids**, then subscribe; **contract create/sign** requires active subscription |
| Tickets | Shared `support_tickets` + required **`sourceApp: 'app1' \| 'app2'`** (one queue, filterable) |
| Implementation | **Port modules into App1** (Approach 1); App2 keeps existing PayPal webhook |
| Deal % fee | **Not** added to App1 |

## 3. Architecture

```
App1 (Seller Tract)                    App2 (Buyer Tract)
├─ subscriptions (create/cancel/sync)  ├─ subscriptions (create/cancel/sync)
├─ usage counters (bid free tier)      ├─ usage counters
├─ tickets (sourceApp=app1)            ├─ tickets (sourceApp=app2)
└─ NO PayPal webhook                   └─ PayPal WEBHOOK (sole receiver)
              │                                    │
              └──────── shared MongoDB ────────────┘
                 users
                 app2_subscriptions
                 app2_usage_counters
                 support_tickets (+ sourceApp)
```

**Webhook clarification:** PayPal POSTs renewal/cancel/sale events to App2 only  
(`https://<app2-api>/api/v1/payments/paypal/webhook`). App1 creates checkout and reads/writes the same subscription documents; it does not need `PAYPAL_WEBHOOK_ID`.

## 4. Subscription

### 4.1 Data

- Collection: **`app2_subscriptions`** (name kept for compatibility).
- One document per `userId` (unique).
- Entitlement: `paidUntil > now` and status in paid set (`ACTIVE` / `CANCELLED` / `EXPIRED` / `PAID_TEST` per existing App2 policy). Approval alone does not grant access.
- Usage free tier: shared **`app2_usage_counters`** with kind `bid` (and App2’s existing `listing` kind). Lifetime **10** free attempts across apps for the same user.

### 4.2 Pricing / roles

| Role | Monthly USD | Required? |
|------|-------------|-----------|
| wholesaler | 50 | Yes (after free bids / for contract) |
| realtor | 100 | Yes (same) |
| buyer (App2) | 100 | Yes (existing) |
| seller | — | No |
| admin | — | No |

Same PayPal plans: `PAYPAL_WHOLESALER_PLAN_ID` ($50), `PAYPAL_BUYER_PLAN_ID` ($100 for buyer + realtor).

### 4.3 App1 API (mirror App2)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/subscriptions/me` | Status payload |
| GET | `/subscriptions/allowance/bid` | Free remaining |
| POST | `/subscriptions/paypal` | Start checkout; body `termsVersion` |
| POST | `/subscriptions/mock-checkout` | Only when `SUBSCRIPTION_MODE=mock` |
| POST | `/subscriptions/refresh` | Re-fetch PayPal subscription details |
| POST | `/subscriptions/cancel` | Cancel at PayPal |

Reuse App2 `subscription-policy.ts` semantics (`subscriptionAmount`, `paidThrough`, terms version).

### 4.4 App1 gates

1. **Place bid** (wholesaler/realtor): `UsageLimitService.consumeAttempt(userId, 'bid')` — 10 free lifetime, then `SUBSCRIPTION_REQUIRED` if not active.
2. **Contract create / party sign**: `SubscriptionsService.assertCanExecute(userId)` when `SUBSCRIPTION_MODE=paypal`.
3. **Seller:** never gated by subscription.
4. **Mock mode:** `assertCanExecute` no-ops (same as App2); mock checkout for local QA.

### 4.5 App1 UI

- `/settings/subscription` — status, Subscribe with PayPal, cancel, refresh (mirror App2 `SubscriptionPage`).
- Bid + contract flows: surface `SUBSCRIPTION_REQUIRED` with CTA to subscription settings.
- Frontend flag: `VITE_SUBSCRIPTION_MODE=paypal` when live.

### 4.6 Explicit non-goals (fees)

- No App1 payment records for deal % fees.
- Do not wire App1 contracts/deals to PayPal Orders capture for platform fee.
- Legacy user flags `app1_platformFeePaid` / `app2_platformFeePaid` are **not** the SaaS source of truth; entitlement is `app2_subscriptions.paidUntil`.

## 5. Support tickets

### 5.1 Schema change (shared)

Add to `SupportTicket`:

```ts
sourceApp: 'app1' | 'app2'  // required, indexed
```

- App1 creates with `sourceApp: 'app1'`.
- App2 creates with `sourceApp: 'app2'`.
- One-time backfill: existing tickets → `sourceApp: 'app2'`.

### 5.2 App1 API (port App2)

| Method | Path | Who |
|--------|------|-----|
| POST | `/tickets` | Authenticated |
| GET | `/tickets` | User: mine; Admin: all (`?sourceApp=` optional) |
| GET | `/tickets/:id` | Owner or admin |
| PATCH | `/tickets/:id` | Reply (owner/admin); status/assign (admin) |
| PATCH | `/tickets/:id/claim` | Admin |

Statuses: `open` | `in_progress` | `resolved` | `closed`.  
Priorities: `low` | `medium` | `high` | `urgent`.  
In-app notifications on create / reply / resolved (same types as App2).

### 5.3 App1 UI

Replace FAQ-only `/support` with:

| Path | Purpose |
|------|---------|
| `/support` | My tickets |
| `/support/new` | Create |
| `/support/:id` | Thread + reply |
| `/support/faq` | Existing FAQ content moved here |

Admin uses the same list with full queue + `sourceApp` filter.

### 5.4 App2 delta

- Set `sourceApp: 'app2'` on create.
- Admin list supports optional `sourceApp` query filter.
- Schema must accept the new field (backward-compatible default/backfill).

## 6. PayPal environment checklist

### Already have

- `PAYPAL_CLIENT_SECRET`

### Required

| Variable | App1 BE | App2 BE | Notes |
|----------|---------|---------|-------|
| `PAYPAL_CLIENT_ID` | ✓ | ✓ | Pair with secret |
| `PAYPAL_CLIENT_SECRET` | ✓ | ✓ | |
| `PAYPAL_MODE` | ✓ | ✓ | `sandbox` then `live` |
| `PAYPAL_WHOLESALER_PLAN_ID` | ✓ | ✓ | $50 plan |
| `PAYPAL_BUYER_PLAN_ID` | ✓ | ✓ | $100 plan |
| `PAYPAL_WEBHOOK_ID` | — | ✓ | App2 webhook only |
| `SUBSCRIPTION_MODE` | ✓ | ✓ | `mock` until cutover; then `paypal` |
| `VITE_SUBSCRIPTION_MODE` | App1 FE | App2 FE | `paypal` when live |

**Provision plans:** `node scripts/setup-paypal-subscriptions.cjs` (App2) or PayPal Dashboard.  
**Webhook URL (App2):** `https://<app2-api-host>/api/v1/payments/paypal/webhook`

Both apps must use the **same** MongoDB URI (already true for shared `users`).

## 7. Rollout

1. Confirm shared Mongo between App1 and App2.
2. App2: add `sourceApp` + backfill tickets.
3. App1: port subscriptions, usage counters, tickets modules + settings/support UI.
4. Wire bid + contract gates.
5. Sandbox E2E: subscribe in App1 → `/subscriptions/me` active in App2 (and reverse).
6. Production: set `SUBSCRIPTION_MODE=paypal` and matching Vite flags; register App2 webhook if not already.

## 8. Testing

- Mock mode: mock-checkout grants `PAID_TEST` / `paidUntil`; gates open.
- PayPal sandbox: approval → webhook/sale → `paidUntil` set; cross-app status match.
- Free tier: 10 bids without sub succeed; 11th blocked until active.
- Seller never blocked by subscription.
- Tickets: App1 ticket visible to admin with `sourceApp=app1`; reply/claim/resolve notifications fire.
- Cancel in one app reflects in the other after refresh/sync.

## 9. Out of scope

- App1 one-time deal platform fee / PayPal Orders for deals.
- Moving PayPal webhook receiver to App1.
- Shared npm package extraction (Approach 3).
- Title-rep subscription tiers.
- Changing App2’s existing 0.75% deal fee behavior (unchanged by this work).
