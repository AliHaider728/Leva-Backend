# Routine/cart and bundle ordering fixes (BUG 43–47)

- Selected routine cards and summary rows have explicit one-click Remove controls.
- Each add creates one independent custom routine cart entry. Component quantities, variations and pricing are nested under that entry. Standalone products remain separate. Increasing the parent quantity buys another copy of that routine without recomputing a duplicate-product bonus.
- Routine prices include the configured discount once. Checkout posts one parent with routineComponents; the server reloads products, variants, pricing offers and discount settings, checks availability and verifies the submitted total. Client-provided component prices/names are not authoritative.
- Orders persist one order_items row plus a nullable JSON routineComponents snapshot. Customer confirmation, account orders, admin order details and email receipts list its contents. Component inventory changes are transactional; cancellation restores the recorded components, including selected variants.
- Old individually flagged routine cart entries are grouped on hydration. Previous normal/routine merge identity could combine the same product across contexts. New routines cannot merge into standalone product quantities. Fresh product add was verified at 1, then 2 after one more add; no double-handler behavior was reproduced.
- The permanent added-state disable was removed. The action remains available after the drawer closes or reopens and after navigation.
- Bundle creation assigns max(displayOrder)+1 inside a locking transaction, ignoring the old default zero. Existing bundle positions are preserved.

## Deployment

Run `npm run migrate:routine-orders` before deploying the updated backend. The additive migration has already been applied to the configured database. Deploy backend and frontend together for the new cart payload. Existing premade bundle checkout remains on its prior branch.

The explicitly requested one-time database ordering correction was applied and verified:
1. Clear Acne Care Duo — displayOrder 0
2. The Glow Bundle — displayOrder 1
3. Alvora Glow & Care Bundle — displayOrder 2

## Validation

- Frontend `scripts/routine-cart-browser.mjs`: real local Next pages, API fixture responses, all order submissions intercepted. Five discount scenarios, all product photos, both remove controls, one combined cart entry, repeat add after close, parent quantity, checkout request/confirmation, standalone 1→2, routine/standalone isolation, mobile overflow.
- Backend `scripts/routine-orders.test.ts`: discount tiers, fixed bonus, parent quantity, variants, inventory restoration, price tampering, duplicate components, unavailable stock, and confirmation email contents.
- Backend `scripts/bundle-gallery-api.test.ts`: real bundle create route now asserts append ordering as well as gallery behavior.
- Backend `scripts/routine-orders-database.test.ts`: real MySQL order/item insert and JSON retrieval inside a rolled-back transaction; stock restoration checked. No test order was retained and no notifications were sent.

Local browser and database tests do not constitute a public-site deployment. Code changes still need deployment; only the migration and explicitly requested ordering correction have changed the configured database.
