# Build Your Routine

The storefront lives at `/bundles/build`. Admins configure it at
`/admin/routine-discounts` (the **Routine Discounts** navigation item).

Deploy both the frontend and backend changes together. The public settings
response includes `routineDiscount`. `GET /api/settings/routine` returns the same
configuration; `PUT /api/settings/routine` accepts the complete configuration and
requires an admin or super-admin JWT.

```json
{
  "minimumDistinctProducts": 2,
  "tiers": [
    { "minProducts": 2, "discountPercent": 10 },
    { "minProducts": 3, "discountPercent": 15 }
  ],
  "quantityBonusEnabled": true,
  "quantityBonusPercent": 5
}
```

The highest qualifying distinct-product-count threshold applies. The minimum
is a separate gate for both tier and bonus. Quantities and variants of the same
product do not count as additional distinct products. When paid quantity exceeds
distinct product count, the enabled bonus adds percentage points exactly once.
Discounts apply to routine-tagged cart lines, not unrelated cart products. Savings
are rounded once to whole PKR before subtracting, matching storefront formatting.

Settings are persisted in the singleton MySQL table `routine_discount_settings`.
The first successful admin save creates this table if absent, so the database
user needs `CREATE` permission for that save (or provision the following table
ahead of time). No existing settings schema is altered. Reads return defaults
only when the table/row does not exist; database failures are surfaced as errors.

```sql
CREATE TABLE IF NOT EXISTS routine_discount_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  config JSON NOT NULL,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

Order creation recalculates routine pricing and discounts using persisted rules.
A changed price/rule rejects a stale submitted discount and asks the customer to
refresh. Coupon amounts are read from the database, and combined savings cannot
exceed the subtotal.

## Verification

- Frontend: `node node_modules/tsx/dist/cli.mjs --test scripts/routine-discount.test.ts`
- Backend: `node node_modules/tsx/dist/cli.mjs --test scripts/routine-api.test.ts`
- Browser: with the frontend running locally, `node scripts/routine-browser.mjs`
  from the frontend directory. Set `ROUTINE_PREVIEW_URL` to override port 3000 and
  `ROUTINE_QA_OUTPUT` to choose a screenshot directory.

The API tests use a fake database and disable mail/analytics. Browser tests read
public catalog photos but intercept API requests and all writes; they do not
change production settings or place real orders. Browser arithmetic fixtures use
Rs. 1,000 per item; final screenshots use actual public catalog prices/photos.

The pure discount module is identical in both independently deployed repositories.
The frontend parity test expects the backend checkout in the sibling `backend`
directory, as in this workspace.
