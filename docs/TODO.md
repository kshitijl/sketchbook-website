# Build TODO

See `docs/architecture.md` for the full design. This is the ordered task breakdown.

## Phase 0 — Scaffolding
- [ ] `npm create astro@latest` (TypeScript, minimal template)
- [ ] Add `@astrojs/cloudflare` adapter, set `output: "server"` in `astro.config.mjs`
- [ ] Add `wrangler.toml` / `wrangler.jsonc` with the Worker name and compatibility date
- [ ] Create the R2 bucket (`wrangler r2 bucket create`) and add its binding to wrangler config
- [ ] Confirm local dev works with bindings: `astro dev` (or `wrangler dev`) can read/write the R2
      binding in local emulation
- [ ] Add `.gitignore` for `node_modules`, `.astro`, `dist`, `.wrangler`
- [ ] Decide and record the production custom domain / route

## Phase 1 — Data layer
- [ ] Define the piece record TypeScript type (`stage`, `location`, `tags`, `notes`, `favoriteRank`,
      `assets[]`) per `docs/architecture.md`
- [ ] Write `getPieces()` — reads `data/pieces.json` from R2, returns parsed data + ETag
- [ ] Write `savePieces(data, expectedEtag)` — conditional PUT (`onlyIf: {etagMatches}`), retry-on-
      conflict by re-reading and re-applying the change
- [ ] Decide id-generation scheme (slug from date+title, collision check against existing ids)
- [ ] Seed an initial empty `data/pieces.json` (`{ "pieces": [], "pinnedLinks": [] }`) in R2
- [ ] Write a small internal script/route to bulk-import pieces later (used in Phase 7)

## Phase 2 — Public read pages
- [ ] Shared layout (nav, minimal CSS, no framework JS by default)
- [ ] `/` home — favorites (by `favoriteRank`), recent pieces (by `date`), pinned quick-links, phase
      density indicator
- [ ] `/piece/[id]` — full detail: primary (`kind: final`) image, other assets, tags, date, notes
- [ ] `/tag/[slug]` — all pieces containing that tag in `tags[]`
- [ ] `/kind/[kind]` — all assets across all pieces matching that `assets[].kind`
- [ ] `/timeline` — chronological list + the derived phase density chart
- [ ] non-JS `/browse` — plain list grouped by `location.placeName`
- [ ] Uniform `Cache-Control: max-age=60` (or similar) helper applied to every page response and to
      the `data/pieces.json` fetch route used by client islands
- [ ] 404 page

## Phase 3 — Images
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
