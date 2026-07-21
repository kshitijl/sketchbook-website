# Build TODO

See `docs/architecture.md` for the full design. This is the ordered task breakdown.

## Phase 0 — Scaffolding
- [x] `npm create astro@latest` (TypeScript, minimal template)
- [x] Add `@astrojs/cloudflare` adapter, set `output: "server"` in `astro.config.mjs`
- [x] Add `wrangler.jsonc` with the Worker name, compatibility date, and R2 binding (`ART_BUCKET`)
- [ ] Create the *real* R2 bucket in Cloudflare (`wrangler r2 bucket create`) — requires the owner's
      Cloudflare login, not done yet. Local dev/build use wrangler's local R2 emulation and don't
      need this.
- [x] Confirm local dev works with bindings: verified under both `astro dev` and `wrangler dev`
      (real Workers runtime) against the local-emulated `ART_BUCKET`
- [x] Add `.gitignore` for `node_modules`, `.astro`, `dist`, `.wrangler`
- [ ] Decide and record the production custom domain / route

## Phase 1 — Data layer
- [x] Define the piece record TypeScript type (`stage`, `location`, `tags`, `notes`, `favoriteRank`,
      `assets[]`) per `docs/architecture.md` — `src/lib/types.ts`
- [x] Write `getPieces()` — reads `data/pieces.json` from R2, returns parsed data + ETag —
      `src/lib/data.ts`
- [x] Write `savePieces(data, expectedEtag)` — conditional PUT (`onlyIf: {etagMatches}`), throws
      `ConflictError` on mismatch for the caller to retry — `src/lib/data.ts`
- [x] Id-generation scheme: `<date>-<slugified-title>` with numeric suffix on collision —
      `src/lib/ids.ts`. Asset keys get a `Date.now()` version suffix so replacing an image never
      needs cache invalidation.
- [ ] Seed an initial empty `data/pieces.json` (`{ "pieces": [], "pinnedLinks": [] }`) in the *real*
      R2 bucket once it exists (code already handles a missing object as the empty-data case)
- [ ] Write a small internal script/route to bulk-import pieces later (used in Phase 7)

## Phase 2 — Public read pages
- [x] Shared layout (`src/layouts/Base.astro`) — nav, minimal CSS, no framework JS by default
- [x] Uniform `Cache-Control: public, max-age=60` helper (`src/lib/cache.ts`), applied to the home
      page — apply the same to every other page below as it's built
- [x] `/` home — favorites (by `favoriteRank`), recent pieces (by `date`); reads live from R2,
      verified against an empty bucket. Still needed: pinned quick-links content once any exist,
      phase density indicator
- [ ] `/piece/[id]` — full detail: primary (`kind: final`) image, other assets, tags, date, notes
- [ ] `/tag/[slug]` — all pieces containing that tag in `tags[]`
- [ ] `/kind/[kind]` — all assets across all pieces matching that `assets[].kind`
- [ ] `/timeline` — chronological list + the derived phase density chart
- [ ] non-JS `/browse` — plain list grouped by `location.placeName`
- [ ] Uniform `Cache-Control: max-age=60` (or similar) helper applied to every page response and to
      the `data/pieces.json` fetch route used by client islands
- [ ] 404 page

## Phase 3 — Images
- [ ] Note: the Cloudflare adapter auto-enables a Cloudflare *Images* binding for Astro's built-in
      `<Image>` component by default (seen in build/dev logs) — decide whether to use that or stick
      with the plan's raw `<img>` + `/cdn-cgi/image/...` transform URLs against R2, so we don't end
      up with two competing image pipelines
- [ ] Admin image upload endpoint: accept multipart upload, write to R2 under
      `assets/<piece-id>/<asset-id>-v<n>.<ext>`, never reuse a key
- [ ] Wire image `<img>` tags across all pages to the Cloudflare Image Transformation URL pattern
      (`/cdn-cgi/image/width=...,format=auto/...`) instead of raw originals
- [ ] Verify responsive sizes: thumbnail (list/grid views), medium (detail view), original
      (download/zoom link)
- [ ] Confirm cache headers on transformed image responses are long-lived/immutable

## Phase 4 — Map island
- [ ] Leaflet setup as an Astro island (`client:visible` or similar), free tile source
- [ ] Marker rendering from `data/pieces.json` (id, lat/lng, thumbnail, tags for pin styling)
- [ ] Clustering when zoomed out
- [ ] Hover popup with thumbnail
- [ ] Click → inline detail panel, hand-written vanilla JS render function (mirrors the
      `/piece/[id]` Astro template's content, intentionally duplicated per the architecture doc)

## Phase 5 — Admin
- [ ] Cloudflare Zero Trust: create Access application covering `/admin/*` and `/admin/api/*`
- [ ] Configure Google as the identity provider (OAuth client in Google Cloud Console, wired into
      Cloudflare Zero Trust dashboard)
- [ ] Access policy: allow only the owner's email
- [ ] `/admin` upload form: image file(s) + title/date/stage/location/tags/notes fields
- [ ] `/admin` edit form: load existing piece, edit any field, add/replace assets
- [ ] `/admin` favorites reorder: numeric rank field per row, plain form submit
- [ ] (Optional hardening) verify `Cf-Access-Authenticated-User-Email` header server-side in
      mutation handlers as defense-in-depth

## Phase 6 — Polish
- [ ] Visual design pass: palette (pastels, purple/pink/red), typography, overall aesthetic
- [ ] Confirm phase/density chart reads well on the timeline
- [ ] Test the full admin flow on a phone (upload + retag + reorder favorites)
- [ ] Deploy to production custom domain, confirm cold-region load behavior is acceptable
- [ ] Sanity-check Tiered Cache is enabled

## Phase 7 — Content migration
- [ ] Inventory existing scans/photos and what metadata exists for each
- [ ] Bulk-import pass: create piece records for everything that already has a final scan
- [ ] Backfill locations/dates/tags for pieces missing them
- [ ] Attach reference photos / in-progress shots / value studies / setup photos where available
