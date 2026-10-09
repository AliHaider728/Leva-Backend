# Bundle gallery images

Bundles expose `galleryImages: string[]` on both list and detail APIs. The existing
`image` field remains the main thumbnail. Gallery URLs are ordered, optional,
and limited to eight. Create and update accept the full ordered array; sending
`[]` clears it, while omitting the field preserves it on update.

Storage mirrors `product_images`: the new `bundle_images` table has `id`,
`bundle_id`, `url`, and `position`, with a unique `(bundle_id, position)` key.
Bundle updates replace these rows inside the same transaction as the rest of the
bundle. Deleting a bundle removes its gallery rows in that transaction. Removing
a gallery entry only detaches it; it does not delete shared media from storage.

Run `npm run migrate:bundle-gallery` before deployment. This idempotent migration
only creates the table. Existing bundles keep empty galleries. Admin saves also
ensure the table exists for older installations; public reads tolerate a missing
table without mutating the database. Other database errors are not swallowed.

The previous detail gallery combined `bundle.image` with every included product's
`images` array. That implicit source has been removed. The gallery now shows the
main bundle thumbnail followed by its saved gallery, preserving order and removing
duplicate URLs. An empty gallery shows only the main thumbnail, with no strip.
If no bundle image exists at all, the generic image placeholder is used.

Admin create/edit pages share `BundleGalleryImages`, using the same upload API,
file types, previews, and arrow ordering controls as the product editor. Multiple
uploads, replacement, removal, and up to eight images are supported. Saving is
disabled during uploads. Partially successful uploads are retained with an error
message for retrying remaining files. Uploads use the existing storage endpoint;
the media objects are only attached to a bundle when the bundle is saved.

## Checks

- Backend: `node node_modules/tsx/dist/cli.mjs --test scripts/bundle-gallery-api.test.ts`
- Frontend: `node node_modules/tsx/dist/cli.mjs --test scripts/bundle-gallery.test.ts`
- End to end: start `scripts/bundle-gallery-preview.ts` with backend `tsx`, then
  `node scripts/bundle-gallery-preview.mjs` in the frontend, followed by
  `node scripts/bundle-gallery-browser.mjs` in the frontend.

The browser harness uses an isolated temporary frontend and the real bundle API
routes with an in-memory database/storage fixture. It uploads actual local files,
compares their bytes, saves/reloads and clicks each thumbnail, tests replace/delete,
and checks that a second bundle remains unchanged. It does not modify production
bundles. `GALLERY_QA_OUTPUT` controls screenshots; `GALLERY_BROWSER_PATH` can select
an installed Chrome executable when the Puppeteer browser is unavailable.

Frontend and backend must both be deployed before verifying the public live site.
