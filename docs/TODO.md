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
- [ ] Home page: also show a small section of randomly-picked pieces (not just favorites/recent) —
      a "rediscover something old" section
- [x] "Paintings done" counter (meant to be motivating: "175 lifetime, 25 this year, 75 more to
      100"): `isPainting()` and `getPaintingStats()` in `src/lib/facets.ts`, rendered as a section
      on the home page. **Working definition of "painting", not yet confirmed with the artist**:
      a *finished* piece tagged with at least one wet medium (watercolor/gouache/oil/acrylic) —
      checked directly against tags (not via the stricter `classifyMedium()`) so a mixed piece
      like ink+watercolor still counts. Revisit this definition if it doesn't match how the artist
      actually thinks about "a painting" (e.g. maybe studies should count, maybe the medium list
      is wrong, maybe it should be manually flagged per piece instead of inferred from tags).
      Milestone is currently always "next multiple of 100 this year" — may want lifetime
      milestones too, or a configurable target.
- [x] `/piece/[id]` — full detail: tags, date, stage, location, notes, real images (final piece
      first, then the rest), an Edit link. 404s (with `Astro.response.status`) when the id doesn't
      exist.
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
- [x] Admin image upload: accept multipart upload, write to R2 under
      `assets/<piece-id>/<asset-id>-v<timestamp>.<ext>`, never reuse a key — done as part of the
      admin new/edit forms (`src/lib/ids.ts`'s `buildAssetKey`)
- [x] Raw image serving route (`src/pages/img/[...key].ts`) — streams an R2 object directly with
      `writeHttpMetadata`/etag and a long immutable Cache-Control (safe since keys are versioned).
      `imageUrl(r2Key)` helper in `src/lib/images.ts` builds the URL. Wired into every page that
      shows an image: `/piece/[id]`, `/kind/[kind]`, `PieceThumb.astro` (used by home/timeline/
      tag/browse/admin listings). Verified end-to-end: real bytes, correct content-type, 404 on a
      missing key.
- [ ] This is a **plain passthrough today, not yet using Cloudflare Image Transformations**
      (`/cdn-cgi/image/width=...,format=auto/...`) — that URL pattern only works on Cloudflare's
      real edge network, not in local dev/wrangler dev, so it couldn't be verified locally and was
      deferred. Once deployed: wrap `imageUrl()` to route through `/cdn-cgi/image/...` pointing at
      the same `/img/...` passthrough, verify resizing/format-negotiation actually works against
      the real zone, and decide on thumbnail/medium/original size variants.
- [ ] Note: the Cloudflare adapter auto-enables a Cloudflare *Images* binding for Astro's built-in
      `<Image>` component by default (seen in build/dev logs) — we are not using that (using raw
      `<img>` + our own `/img/...` route instead, per the above), just flagging it's there so it
      doesn't get confused for our pipeline
- [ ] Determine real image width/height at upload time (currently stored as `0, 0` placeholders) —
      needed for proper aspect-ratio layout/no-layout-shift; Workers runtime has no native image
      decoder, so this needs either a small pure-JS header parser (PNG/JPEG dimensions are readable
      from just the first few bytes) or a WASM image lib

## Phase 4 — Map island
- [x] `/map` page (`src/pages/map.astro`) + `src/scripts/mapPage.ts`, Leaflet + free OSM tiles.
      Implementation choice: rather than a separate fetchable `data/pieces.json` endpoint (as
      originally sketched in docs/architecture.md), the full piece list is embedded directly in
      the page as a `<script type="application/json">` tag (JSON with `<` escaped to `<` so a
      stray `</script>` in a title/note can't break out of the tag) — one fewer request, and it
      automatically inherits the page's own Cache-Control instead of needing separate cache-header
      wiring for a dedicated data route.
- [x] Marker rendering: one marker per piece from the embedded data, map auto-fits bounds to
      whatever pieces exist
- [x] Hover popup with a thumbnail (the primary/final asset)
- [x] Click → inline detail panel below the map (hand-written `renderDetail()` in
      `src/scripts/mapPage.ts`, HTML-escaped since it's built via `innerHTML`) — the intentional
      duplication of `/piece/[id]`'s content noted in docs/architecture.md as the accepted cost of
      not using htmx
- [x] Verified end-to-end locally: page loads, all pieces present in the embedded JSON, compiled
      script module loads without error
- [ ] Clustering when zoomed out — not yet needed at current piece counts, revisit once there's
      enough real data to make a zoomed-out view crowded
- [ ] Area-select: draw/drag a selection box on the map and view every piece whose location falls
      within it as a small gallery (a filtered grid, not just a list) — distinct from clicking a
      single pin

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
      emulation, including with an existing `pieces.json` present (the ETag conditional-write path).
  - [x] "Select image" is the first field, with an on-select preview (`URL.createObjectURL`)
  - [x] Title auto-suggested from the image filename (strip extension, hyphens/underscores,
        digits, then title-case) — only fills if the title field is still empty, never clobbers
        something already typed
  - [x] Date defaults to today
  - [x] Location is a Leaflet map (click to place a marker) instead of typing lat/lng, plus a
        "use my current location" button that also fires automatically on page load
  - [x] Tags show as clickable chips of every previously-used tag, sorted by frequency
        (`getTagFrequency()` in `src/lib/facets.ts`), clicking appends to the tags field
  - [ ] Location is still click-a-point-on-a-map only — no address/place-name text search yet.
        Would need a geocoding API (e.g. Nominatim); worth adding if clicking the right spot on a
        zoomed-out world map proves fiddly in practice
  - [ ] Research: can useful metadata (GPS location, capture date, camera/lens, settings) be pulled
        automatically from a photo's EXIF data — e.g. from an image exported out of Apple
        Photos/iOS — to pre-fill date/location instead of relying on manual entry or device
        geolocation at upload time? Investigate before building; not started
- [x] `/admin/edit/[id]` — load an existing piece, edit every metadata field, and per asset kind:
      see the current image (if any), replace it, add one if missing, or check a box to remove it;
      a separate delete-the-whole-piece action (with a confirm() prompt). Shares the location
      map/tag-chips/preview/title-suggestion behavior with the new-piece form via
      `src/scripts/pieceForm.ts` (`setupPieceForm()`), rather than duplicating that JS a second
      time — only difference is the edit form pre-fills values and doesn't auto-fire geolocation.
      Verified end-to-end: pre-filled fields, editing metadata, adding an asset kind that didn't
      exist yet, removing one, and deleting the piece entirely.
- [x] `/admin/favorites` — numeric rank field per row (blank = not a favorite), plain form submit.
      Entered numbers only need the right relative order — submit reassigns clean, gap-free 1..N
      ranks rather than requiring perfectly sequential input. Verified end-to-end: setting ranks,
      leaving one blank, and confirming the home page's Favorites section reflects the new order
      and excludes the blank one.
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
