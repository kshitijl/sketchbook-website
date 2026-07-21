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
- [x] Uniform `Cache-Control: public, max-age=60, s-maxage=2592000` helper (`src/lib/cache.ts`;
      1min browser / 30 days edge, purge-driven not TTL-driven — see docs/architecture.md), applied
      to the home page — apply the same to every other page below as it's built
- [x] `/` home — favorites (by `favoriteRank`), recent pieces (by `date`); reads live from R2,
      verified against an empty bucket. Still needed: pinned quick-links content once any exist,
      phase density indicator
- [x] `/piece/[id]` — full detail: tags, date, stage, location, notes, asset list (images pending
      Phase 3 — currently lists kind/caption/r2Key as text). 404s (with `Astro.response.status`)
      when the id doesn't exist.
- [x] `/tag/[slug]` — all pieces containing that tag in `tags[]`
- [x] `/kind/[kind]` — all assets across all pieces matching that `assets[].kind`; 404s on an
      unrecognized kind
- [x] `/timeline` — chronological list + a derived phase density bar (dry vs. wet media per month,
      from `classifyMedium()` in `src/lib/facets.ts` — no manual phase tagging)
- [x] non-JS `/browse` — plain list grouped by `location.placeName`
- [x] Uniform `Cache-Control: public, max-age=60, s-maxage=2592000` applied to every page built so
      far — still need to apply it to the `data/pieces.json` fetch route once the map island needs
      it (Phase 4)
- [ ] 404 page — currently just a 404 status + inline message on `/piece/[id]` and `/kind/[kind]`;
      a real Astro `404.astro` catch-all for unmatched routes generally is still needed
- [x] Verified all routes (200s, and 404s for a missing piece / bad kind) end-to-end under
      `wrangler dev` against the real Workers runtime

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
- [ ] Cloudflare Zero Trust: create Access application covering `/admin/*` and `/admin/api/*` — not
      done yet, requires the owner's Cloudflare login. Until then, `/admin` is open in every
      environment, including local dev (Access isn't emulated locally at all — it's an edge-only
      product, not a binding — so this is expected, not a bug)
- [ ] Configure Google as the identity provider (OAuth client in Google Cloud Console, wired into
      Cloudflare Zero Trust dashboard)
- [ ] Access policy: allow only the owner's email
- [x] `/admin` index (`src/pages/admin/index.astro`) — lists existing pieces, links to `/admin/new`
- [x] `/admin/new` upload form (`src/pages/admin/new.astro`) — title/date/stage/location/tags/notes
      + up to 5 image fields (one per asset kind, `final` required). Validates required fields
      (re-renders the form with errors, doesn't lose entered values on failure), generates the
      piece id and asset R2 keys (`src/lib/ids.ts`), uploads images to R2, then writes the piece via
      `updatePieces()` (`src/lib/data.ts` — the shared read-modify-write-with-retry helper other
      admin writes will reuse) and redirects to `/piece/<id>`. Verified end-to-end against local R2
      emulation: successful submission, redirect, the new piece appearing on home/timeline/tag
      pages, and validation errors on a bad submission.
- [ ] `/admin` edit form: load existing piece, edit any field, add/replace assets, delete a piece
- [ ] `/admin` favorites reorder: numeric rank field per row, plain form submit
- [ ] (Optional hardening) verify `Cf-Access-Authenticated-User-Email` header server-side in
      mutation handlers as defense-in-depth
- [ ] Create a Cloudflare API token scoped to Cache Purge for this zone; store it and the zone ID
      as Worker secrets (`wrangler secret put`)
- [ ] After every successful admin write (post-conditional-PUT), call Cloudflare's purge API with
      `purge_everything: true`. Treat as best-effort/fire-and-forget — log failures, don't fail the
      write itself, since a missed purge self-heals on the next edit's purge anyway

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
