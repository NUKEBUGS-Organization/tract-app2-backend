# App1 Property Source Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop auto-LIVE App1→App2 sync; App1 deals only appear in Create Listing Property Source; selecting one jumps to Deal Type & Fees to set purchase price + assignment fees before publish.

**Architecture:** Invert `APP1_SYNC_ENABLED` default so the poller is off unless explicitly enabled. Frontend: on App1 deal select, autofill and `goToStep('deal')`; show purchase price on the deal step for App1-sourced listings; require assignment fees; skip Media and go Review after fees for App1 path.

**Tech Stack:** NestJS + ConfigModule, React + React Router search params, existing `useClosedApp1Deals` / Create Listing wizard.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-04-app1-property-source-pricing-design.md`
- Do not bulk-unpublish existing `app1SyncManaged` LIVE listings
- Keep partial unique index on `app1DealId`
- Manual “Create New Property” keeps full wizard (source → arv → deal → media → review)
- CapRover: set `APP1_SYNC_ENABLED=false` on buyer-backend after deploy (code default also false)

## File map

| File | Responsibility |
|------|----------------|
| `tract-app2-backend/src/config/configuration.ts` | Default sync poller **off** |
| `tract-app2-backend/.env.example` | Document `APP1_SYNC_ENABLED` |
| `tract-app2-backend/src/modules/app1-sync/app1-sync.service.ts` | Log text matches new default |
| `tract-app2-frontend/src/pages/wholesaler/CreateListingPage.tsx` | Jump to fees, purchase on deal step, require fees, skip media for App1 |

---

### Task 1: Disable App1 sync poller by default

**Files:**
- Modify: `tract-app2-backend/src/config/configuration.ts` (app1Sync block ~135–144)
- Modify: `tract-app2-backend/.env.example` (after APP1_INTERNAL_URL / INTERNAL_SERVICE_KEY)
- Modify: `tract-app2-backend/src/modules/app1-sync/app1-sync.service.ts` (onModuleInit log)

**Interfaces:**
- Consumes: `process.env.APP1_SYNC_ENABLED`
- Produces: `config.app1Sync.enabled === true` only when env is exactly `'true'`

- [ ] **Step 1: Change default in configuration.ts**

Replace the `app1Sync` block with:

```ts
  /**
   * App1 -> App2 listing bridge (legacy poller). Default OFF: wholesalers
   * publish via Create Listing Property Source so they can set purchase + fees.
   * Set APP1_SYNC_ENABLED=true only for emergency/ops auto-LIVE.
   */
  app1Sync: {
    enabled: process.env.APP1_SYNC_ENABLED === 'true',
    intervalMs: parseInt(process.env.APP1_SYNC_INTERVAL_MS ?? '120000', 10),
  },
```

- [ ] **Step 2: Document in .env.example**

Add after the INTERNAL_SERVICE_KEY lines:

```env
# App1 -> App2 auto-LIVE poller (default off). Wholesalers list via Create Listing.
# APP1_SYNC_ENABLED=true
# APP1_SYNC_INTERVAL_MS=120000
```

- [ ] **Step 3: Soften disable log in app1-sync.service.ts**

When disabled, log:

```ts
this.logger.log(
  'App1 -> App2 listing sync poller disabled (set APP1_SYNC_ENABLED=true to enable)',
)
```

- [ ] **Step 4: Commit backend**

```bash
cd tract-app2-backend
git add src/config/configuration.ts .env.example src/modules/app1-sync/app1-sync.service.ts
git commit -m "Disable App1 auto-LIVE sync poller by default."
```

---

### Task 2: App1 select jumps to Deal Type & Fees + purchase on that step

**Files:**
- Modify: `tract-app2-frontend/src/pages/wholesaler/CreateListingPage.tsx`

**Interfaces:**
- Consumes: `applyClosedDeal(deal)`, `goToStep('deal')`, `sourceChoice === 'app1'`, `purchaseDigits` / `setPurchaseDigits`
- Produces: Selecting an unlinked App1 deal navigates to `?step=deal`; deal step shows purchase price when `sourceChoice === 'app1'`

- [ ] **Step 1: After autofill in `applyClosedDeal`, jump to deal**

At the end of the unlinked branch of `applyClosedDeal`, after the success toast:

```ts
    toast.success('Listing details imported from Seller Tract.')
    goToStep('deal')
```

Ensure `goToStep` is in scope (defined earlier in the component body).

- [ ] **Step 2: Add purchase price section on deal step for App1**

Inside `{step === 'deal' ? (...`, after market status and before assignment fees, when `sourceChoice === 'app1'`, render a purchase price editor using the same digit-stripping pattern as the ARV-step purchase input. Label it required. Helper copy: imported from Seller Tract; adjust if needed.

- [ ] **Step 3: Commit frontend**

```bash
cd tract-app2-frontend
git add src/pages/wholesaler/CreateListingPage.tsx
git commit -m "Jump App1 Property Source selection to deal fees step."
```

---

### Task 3: Require fees + skip Media for App1 path

**Files:**
- Modify: `tract-app2-frontend/src/pages/wholesaler/CreateListingPage.tsx` (`handleDealNext`, `handleReviewBack`, `buildPayload`, publish guard)

**Interfaces:**
- Consumes: `sourceChoice`, `app1DealId`, `feeLowStr`, `feeHighStr`, `purchaseDigits`, `purchasePrice`
- Produces: App1 path cannot leave deal step without purchase > 0 and both fees; next step is `review`

- [ ] **Step 1: Tighten `handleDealNext`**

For `sourceChoice === 'app1'`: require `purchasePrice > 0`, both fees present and `high >= low`, then `goToStep('review')`. Manual path unchanged (`goToStep('media')`).

- [ ] **Step 2: Fix `handleReviewBack`**

```ts
  const handleReviewBack = () => {
    if (sourceChoice === 'app1') goToStep('deal')
    else goToStep('media')
  }
```

- [ ] **Step 3: No silent 35k fee default when App1-sourced**

In `buildPayload`, if `app1DealId` or `sourceChoice === 'app1'`, missing fees become `0` instead of `35000` / `0.85 * high`. Guard publish/save-and-publish with the same fee checks as `handleDealNext` and toast on failure.

- [ ] **Step 4: Manual smoke check**

1. Unlinked App1 deal → click → Deal Type & Fees.
2. Empty fees → Next → error.
3. Purchase + both fees → Review (skip Media).
4. Create New Property → full wizard still includes ARV and Media.

- [ ] **Step 5: Commit + push**

```bash
cd tract-app2-frontend
git add src/pages/wholesaler/CreateListingPage.tsx
git commit -m "Require App1 listing fees and skip media step."
git push
cd ../tract-app2-backend
git push
```

- [ ] **Step 6: Ops**

CapRover `buyer-backend`: `APP1_SYNC_ENABLED` unset or `false`. Redeploy buyer-backend + buyer-frontend.

---

## Spec coverage

| Spec rule | Task |
|-----------|------|
| Auto-LIVE off by default | Task 1 |
| Select → Deal Type & Fees | Task 2 |
| Purchase + assignment fees | Task 2–3 |
| Skip ARV/Media as next gates | Task 2–3 |
| Manual create unchanged | Task 3 App1-only branches |
| Existing LIVE untouched | No migration |
