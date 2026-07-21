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
- [x] Home page "Rediscover" section: `getRandomPieces()` in `src/lib/facets.ts`, excludes whatever
      is already in "Recent" so it doesn't just repeat it. Worth noting: this is picked at *render*
      time, which under the purge-on-write cache policy only happens right after an edit or for a
      new edge location — so it's "a random pick that changes when you edit something," not
      "re-randomized every visit." Intentional trade against the caching model, documented in a
      code comment. Verified: correctly hidden right now since there are only 5 total pieces and
      all of them are already in "Recent" (nothing left to pick from) — will populate once there
      are more than 12.
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
- [x] 404 page (`src/pages/404.astro`) for unmatched routes generally, on top of the existing
      404 status + inline message already on `/piece/[id]` and `/kind/[kind]` for a bad id/kind
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
- [x] Real image width/height at upload time — `src/lib/imageDimensions.ts`, a small pure-JS
      PNG/JPEG header parser (dimensions are readable from just the first ~25 bytes, no decoder
      needed). Wired into both the new-piece form and the edit form's add/replace paths (replacing
      previously left dimensions stale — fixed). Used for `width`/`height` attributes on
      `/piece/[id]` and the map's detail panel, so the browser can reserve layout space before the
      image loads. Falls back to `0, 0` (attribute omitted) for anything it doesn't recognize.
      Verified against a manually-constructed 400×300 PNG (correct on upload) and a 150×600
      replacement (correct on replace, not just add).

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
- [x] Defense-in-depth `Cf-Access-Authenticated-User-Email` check — `src/lib/adminGuard.ts`'s
      `isAuthorizedAdminRequest()`, called at the top of every mutation handler (new/edit/delete/
      favorites). **No-ops (always allows) until `ADMIN_EMAIL` is a real value** — it's declared as
      an empty-string placeholder in `wrangler.jsonc`'s `vars` right now so types generate cleanly;
      a real Worker secret overrides it at deploy time. Verified this doesn't block local writes
      (which it shouldn't, since Access itself is the real gate and doesn't exist locally).
- [x] Purge-on-write — `src/lib/purge.ts`'s `purgeEverything()`, called after every successful
      mutation. Same pattern: **no-ops until `CF_API_TOKEN`/`CF_ZONE_ID` are real values**
      (currently empty-string placeholders in `wrangler.jsonc`). Best-effort/fire-and-forget —
      failures are swallowed, not surfaced, since a missed purge self-heals on the next write's
      purge regardless of what that write touched.
- [ ] Still to do during the Cloudflare setup pass: create the Cache-Purge-scoped API token and
      note the zone ID, decide the real `ADMIN_EMAIL`, and set all three as Worker secrets
      (`wrangler secret put`) — no code changes needed, both features activate automatically
- [ ] **Required, easy to miss**: create a Cache Rule for the zone (`Eligible for cache: Yes`,
      `Edge TTL: respect origin headers`) covering the whole hostname. Cloudflare does not cache
      HTML at the edge by default regardless of `Cache-Control` — eligibility is decided by file
      extension, not header presence. Without this one rule, every request silently hits the
      Worker and re-renders — the entire "renders once, then pure cache" premise depends on it.
      See docs/architecture.md's Cache policy section.

## Full code review pass (2026-07-21)
Went through every file for simplicity and correctness per an explicit request to "check
everything, keep it as simple as possible." Findings, all fixed:
- [x] Removed `applyPageCacheHeaders()` from `src/lib/cache.ts` — dead code, never called (every
      page sets the header directly instead)
- [x] `404.astro` was missing its `Cache-Control` header (inconsistent with every other page,
      relied on Cloudflare's default instead of an explicit contract) — added
- [x] Extracted `PieceList.astro` — the exact same piece-list rendering block was duplicated
      identically 6 times across `index.astro` (×3), `timeline.astro`, `browse.astro`, and
      `tag/[slug].astro`. `admin/index.astro` and `admin/favorites.astro` deliberately still
      render their own (they have genuinely different extra content — an edit link, a rank input)
- [x] `kind/[kind].astro` hardcoded its own second copy of the 5 asset kind values (`VALID_KINDS`)
      instead of deriving them from `ASSET_KIND_FIELDS` — a real drift risk if a kind is ever
      added. Now derived from the single source of truth.
- [x] `mapPage.ts` re-declared its own local `Asset`/`Piece` interfaces and duplicated
      `imageUrl()`/`getPrimaryAsset()` instead of importing the real ones from `src/lib/` — those
      are pure, environment-agnostic code with no server-only dependencies, so they're perfectly
      safe to import into a client bundle. Removed ~20 lines of duplication.
- [x] Extracted `orderAssetsFinalFirst()` into `src/lib/facets.ts` — the identical "final image
      first" sort was duplicated in `piece/[id].astro` and `mapPage.ts`
- [x] `--accent-3` (the red from "pastel purple/pink/red") was defined in the theme but never
      used, while two admin forms hardcoded `color:#b00` for error messages, bypassing the theme
      entirely (broken in dark mode). Wired the variable in and removed the hardcoded color.
- [x] Fixed a stale comment in `assetKinds.ts` referencing the edit form as not-yet-built

## Phase 6 — Polish
- [x] Visual design, redone per moodboard direction (2026-07-21): "a weird personal art archive
      that feels like a beautifully designed Mac application" — grid/panel/bordered brutalist-UI
      feel rather than the earlier soft pastel-everywhere pass (which the moodboard explicitly
      rejected). Black/cream foundation, strong 2px borders on nav/sections/images/inputs, square
      corners (no border-radius), monospace for labels/nav/tags/captions (system monospace stack,
      no font files), hot pink + purple as accents rather than the whole palette, light/dark
      variants preserved. `src/layouts/Base.astro` only — no page files needed changes since the
      theme is global. Further iteration likely once seen with real content/pieces.
- [x] Debug footer on every page (`Base.astro`): render timestamp + a fresh `crypto.randomUUID()`
      (`renderId`, also exposed as `data-render-id` on the `<footer>` for easy scripted parsing) +
      Cloudflare edge colo (`Astro.request.cf.colo`, falls back to `'local'` off-network), small
      muted monospace text at the very bottom. `renderId` exists specifically to make the
      automated caching check below possible/reliable — a timestamp alone could in principle
      collide at millisecond precision between two genuinely separate renders; a UUID practically
      can't. The precise/authoritative signal for a human is still the `CF-Cache-Status` response
      header (`HIT` vs `MISS`/`EXPIRED`) via `curl -I` or browser devtools — the footer is a
      no-devtools-needed sanity check, not a replacement for that. Verified locally: valid UUID,
      changes on every reload as expected (local dev never edge-caches — this only means something
      once deployed with the Cache Rule above in place).
- [ ] Automated caching-behavior check. **This is a post-deploy smoke test, not a CI/unit test** —
      it depends on real Cloudflare edge behavior (the Cache Rule, `CF-Cache-Status`) that simply
      doesn't exist under local dev, so it can only run against the live deployed site, and only
      makes sense to run after deploying or after touching anything cache-related. No test
      framework needed — a small standalone script using plain `fetch`, run manually:
      1. `fetch` a page URL. Record its `data-render-id` (regex/parse out of the body) and body.
      2. `fetch` the *exact same URL* again, immediately after.
      3. Assert all three, on the second response:
         - `CF-Cache-Status` header is `HIT` (not `MISS`/`EXPIRED`/`DYNAMIC`/`BYPASS`)
         - its `data-render-id` is *identical* to the first response's
         - its body is byte-for-byte identical to the first response's
      If any of those three fail, the page re-rendered instead of being served from cache — the
      Cache Rule isn't doing what it's supposed to, or something is preventing this URL from being
      cache-eligible (e.g. a `Vary` header mismatch, a `Set-Cookie`, wrong content-type handling).
      Worth running this check against one page of each kind (home, a `/piece/[id]`, `/map`, etc.)
      since cacheability could in principle differ per route. Not worth automating into a
      scheduled/CI job for a personal site at this scale — a manual script run occasionally is
      enough insurance for what this is protecting against.
- [ ] Confirm phase/density chart reads well on the timeline
- [ ] Test the full admin flow on a phone (upload + retag + reorder favorites)
- [ ] Deploy to production custom domain, confirm cold-region load behavior is acceptable
- [ ] Sanity-check Tiered Cache is enabled

## Phase 7 — Content migration
- [ ] Inventory existing scans/photos and what metadata exists for each
- [ ] Bulk-import pass: create piece records for everything that already has a final scan
- [ ] Backfill locations/dates/tags for pieces missing them
- [ ] Attach reference photos / in-progress shots / value studies / setup photos where available
