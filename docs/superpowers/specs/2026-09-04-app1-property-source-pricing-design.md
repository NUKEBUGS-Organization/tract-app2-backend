# App1 → App2: Property Source pricing (no auto-LIVE)

**Date:** 2026-09-04  
**Status:** Approved — pending implementation  
**App:** Tract App 2 (Buy TRACT) / Seller Tract (App1) bridge

## Summary

When a wholesaler or realtor has a signed/marketable deal on **App1 (Seller Tract)**, that property must **not** auto-publish to the App2 buyer marketplace. It appears only in **Create Listing → Property Source**. Selecting it autofills listing details and jumps to **Deal Type & Fees**, where they set **purchase price** and **assignment fees**, then publish.

## Product rules

| Rule | Detail |
|------|--------|
| Auto-LIVE sync | **Off.** App1 sync poller must not create/update LIVE marketplace listings for new deals |
| Discovery | Marketable App1 deals (`active`, `proceeding_to_closing`, and existing listable set) appear in Property Source |
| Who | App1 deal **buyer** with role `wholesaler` or `realtor` (shared `users` `_id`) |
| On select | Autofill address, city, state, zip, ARV, photos, purchase price (from App1); skip ARV & Media steps |
| Land on | **Deal Type & Fees** (`step=deal`) |
| Required edits | Wholesaler/realtor may adjust **purchase price** and must set **assignment fee** (low/high as today) |
| Publish | Normal App2 draft → review → publish; then existing App1 `mark-marketing-complete` callback |
| Duplicates | One App2 listing per `app1DealId` (existing partial unique index). Already-linked deals show as Continue/Open, not a second create |
| Manual create | “Create New Property” path unchanged (full wizard) |
| Existing LIVE sync mirrors | Leave as-is (no bulk unpublish in v1) |

## Out of scope (v1)

- Converting or retiring already auto-synced LIVE listings
- Changing App1 deal status machine
- New fee formulas or buyer-facing price display redesign beyond existing assignment fee fields
- Re-enabling draft-only sync poller

## Current behavior (problem)

1. `App1SyncService` poller reads shared Mongo `deals` and creates **LIVE** App2 listings (`app1SyncManaged: true`).
2. `GET /wholesaler/closed-app1-deals` used to hide deals that already had `app1DealId` linked — Property Source looked empty even when App1 deals existed.
3. Resale profit (assignment fee / adjusted purchase) was never collected before marketplace exposure.

## Target flow

```
App1 deal signed / active | proceeding_to_closing
  → App2 does NOT auto-list
  → Wholesaler opens Create Listing
  → Property Source lists App1 deals (hydrated: address, photos, ARV, purchase)
  → Select deal
  → Autofill + navigate to Deal Type & Fees
  → Edit purchase price + set assignment fees (+ deal type / market status)
  → Optional: still can go back to ARV/Media if needed
  → Review → Publish
  → App2 listing LIVE; App1 marketing proof marked complete
```

## Architecture

### Backend

1. **Disable App1 → App2 LIVE sync by default**
   - `APP1_SYNC_ENABLED` default to `false` in `configuration.ts` (invert current “enabled unless false”).
   - CapRover: set `APP1_SYNC_ENABLED=false` on `buyer-backend` if not already.
   - Manual `POST /internal/app1-sync/run` may remain for ops but should not run on a timer when disabled.

2. **Property Source API** (`GET /wholesaler/closed-app1-deals`)
   - Keep returning hydrated App1 listable deals + `linkedListingId` / `linkedStatus` (already shipped).
   - Unlinked deals: no App2 row until create/publish.
   - Linked deals: UI Continue/Open only.

3. **Create listing**
   - Unchanged create DTO; `app1DealId` set when sourced from App1.
   - Publish path + `markMarketingComplete` unchanged.

### Frontend (`CreateListingPage`)

1. Property Source shows App1 deals (linked + unlinked).
2. On select **unlinked** deal:
   - Apply autofill (existing `applyClosedDeal`).
   - **Jump to `step=deal`** (Deal Type & Fees), not ARV.
3. Fees step: purchase price editable; assignment fee low/high required before continue (tighten validation if currently optional defaults).
4. Progress UI: for App1-sourced flow, ARV/Media remain reachable via back/nav but are not the next gate after source.
5. Linked deal click: resume draft/pending wizard or open listing detail (existing).

## Config / ops

| Env | Value |
|-----|--------|
| `APP1_SYNC_ENABLED` | `false` (default + CapRover) |
| `APP1_INTERNAL_URL` | `https://seller-backend.tractcorp.com` |
| `INTERNAL_SERVICE_KEY` | shared with App1 |

Redeploy **buyer-backend** and **buyer-frontend** after implementation.

## Success criteria

- [ ] New App1 marketable deals do not appear on buyer marketplace until wholesaler publishes from App2.
- [ ] Create Listing → Property Source lists those deals for the App1 buyer (wholesaler/realtor).
- [ ] Selecting a deal lands on Deal Type & Fees with other fields filled.
- [ ] Purchase price + assignment fees are set before publish.
- [ ] Manual “Create New Property” still uses the full wizard.
- [ ] No second listing for the same `app1DealId`.

## Risks

| Risk | Mitigation |
|------|------------|
| Ops forgets CapRover env | Code default `false` so timer stays off even if env unset |
| Existing LIVE sync listings confuse users | Document; optional later cleanup ticket |
| Empty fees publish with defaults | Require explicit fee entry on App1-sourced path before leave fees step |
