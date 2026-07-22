# Build TODO

See `docs/architecture.md` for the full design. This is the ordered task breakdown.

## Standing priority: simplicity over cleverness (owner directive, 2026-07-22)
**The owner is a grug-brain developer who hates pointless complexity and code bloat.** This is a
standing preference, not a one-off complaint — every future change in this codebase should be
weighed against it, not just the items below.
- [ ] Remove the `ADMIN_EMAIL`/`isAuthorizedAdminRequest()` defense-in-depth check
      (`src/lib/adminGuard.ts`, called from `admin/new.astro`, `admin/edit/[id].astro`,
      `admin/favorites.astro`). Flagged by the owner as pointless complexity: Cloudflare Access is
      the real gate and already fully verified working (a `302` to login for any unauthenticated
      request, before the Worker even runs) — this second in-app check is redundant belt-and-braces
      the owner doesn't want. Removing it also deletes `src/env.d.ts` (the declaration-merge file
      that only exists to type `ADMIN_EMAIL` as a secret) and the `ADMIN_EMAIL` Worker secret
      itself, and simplifies all three call sites.
- [ ] Full pass over the codebase and `docs/architecture.md`/this file for other pointless
      complexity introduced without being asked for — abstractions, tests, defensive checks, or
      "nice to have" infrastructure the owner never actually requested. Go looking for it
      specifically rather than assuming there isn't more; the `ADMIN_EMAIL` check above was missed
      until the owner caught it themselves. Candidates worth scrutinizing on this pass: whether all
      57 Vitest tests are pulling their weight for a site this size, whether the backup system's
      daily-reconciliation-as-a-separate-Worker split is more machinery than needed, and whether any
      "generalized for future flexibility" code (e.g. `assets[].kind` as an open enum,
      `/kind/<kind>` template) is solving a problem that doesn't exist yet.
- [ ] `pinnedLinks` (`PiecesData.pinnedLinks`, `types.ts`) is now fully dead: there was never an
      admin UI to write it, and as of the 2026-07-22 home page redesign nothing reads it either
      (replaced with 3 hardcoded links — Timeline/Map/`/kind/setup` — directly in `index.astro`,
      since that's all it was ever going to hold). Remove the field/type entirely rather than
      leaving it as unused shape.
- [ ] Fix the process, not just the code: every subsequent edit in this codebase must be
      self-reviewed against this preference before considering it done — would the owner call this
      simple, or would they call it bloat? Lean toward the boring, obvious, least-code solution over
      a clever or "more correct" one; don't add abstractions, tests, or defensive code beyond what
      the task actually needs; three similar lines beat a premature helper. When genuinely unsure
      whether something crosses the line, ask rather than guessing.

## Phase 0 — Scaffolding
- [x] `npm create astro@latest` (TypeScript, minimal template)
- [x] Add `@astrojs/cloudflare` adapter, set `output: "server"` in `astro.config.mjs`
- [x] Add `wrangler.jsonc` with the Worker name, compatibility date, and R2 binding (`ART_BUCKET`)
- [x] Created the real R2 bucket (`31-art-website-data`) via `wrangler r2 bucket create` and
      deployed via `wrangler deploy` — **live at https://31-art-website.klauria.workers.dev**
      (2026-07-21). Smoke-tested all routes (200s, 404 on an unknown path) against production.
- [x] Confirm local dev works with bindings: verified under both `astro dev` and `wrangler dev`
      (real Workers runtime) against the local-emulated `ART_BUCKET`
- [x] Add `.gitignore` for `node_modules`, `.astro`, `dist`, `.wrangler`
- [x] Domain decided: **klauria.art**. Zone added to Cloudflare and active (nameservers switched
      from Namecheap, confirmed via API — `alina.ns.cloudflare.com` / `jarred.ns.cloudflare.com`).
      (Correction, 2026-07-22: the missing `CF-Cache-Status` on `workers.dev` originally observed
      here was blamed on "not a real zone" — wrong diagnosis. The actual cause was that the whole
      design relied on zone-level Cache Rules, which never apply to a Worker generating its own
      response in the first place, on *any* hostname. See the Cache fix entry near the end of this
      file. `workers.dev` now caches correctly via Workers Cache, same as a custom domain would.)
- [ ] **Blocked on a dashboard action only the domain owner can do** — attaching the Custom Domain
      failed with a 409 Conflict: `klauria.art` (and `www.klauria.art`) already have Cloudflare-
      proxied A/AAAA records (imported from Namecheap's default parking setup when the zone was
      added), which occupy the hostname before a Custom Domain can claim it. My Cloudflare
      credential (wrangler's OAuth token) can read zone info but is refused (`Authentication
      error`) on the DNS-records API endpoint, so I can't remove these myself. **To unblock**: in
      the Cloudflare dashboard, DNS tab for klauria.art, delete the existing A/AAAA records at the
      apex (`klauria.art`, and `www` if you want that too) — do **not** touch the MX/TXT records,
      those are Namecheap's email forwarding for this domain and are unrelated/still wanted. Then
      either re-run `wrangler deploy --domain klauria.art`, or just use the dashboard's own "Add
      Custom Domain" flow (Workers & Pages → 31-art-website → Settings → Domains & Routes), which
      prompts to replace a conflicting record automatically instead of just failing like the API
      does.
  - [ ] **Incident during setup, self-inflicted and self-corrected**: the first `--domain`
        attempt implicitly disabled `workers_dev` (a wrangler default when `--domain` is passed
        and `workers_dev` isn't explicit), and when the domain attach then failed, the site was
        briefly down on *both* URLs. Fixed by adding `"workers_dev": true` explicitly to
        `wrangler.jsonc` and redeploying — confirmed back up immediately, and this can't recur
        since it's no longer implicit. Also confirmed (by inspecting the generated
        `dist/server/wrangler.json`) that a `"routes"` field in `wrangler.jsonc` is silently
        dropped by the Astro Cloudflare adapter's deploy-config generation — the `--domain` CLI
        flag is the correct mechanism for this adapter, not the config file field.

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
- [x] **Gap found on review**: docs/architecture.md's page inventory explicitly justified real
      static permalink pages with "sharing, SEO/OG tags" as the reason — but Open Graph meta tags
      were never actually built. Added to `Base.astro` (optional `description`/`image` props,
      generic site description as the default) and wired into `/piece/[id]` with the real
      per-piece description (falls back to date/stage/place if no notes) and an absolute image URL
      (`new URL(imageUrl(...), Astro.url)` — derived from the current request's own origin, so
      it's correct on `workers.dev` today and the eventual custom domain later without code
      changes). Verified end-to-end against the live production site with a real uploaded image:
      correct title/description/image meta tags, `twitter:card` switches to `summary_large_image`
      when there's an image.
- [x] `/tag/[slug]` — all pieces containing that tag in `tags[]`
- [x] `/kind/[kind]` — all assets across all pieces matching that `assets[].kind`; 404s on an
      unrecognized kind
- [x] Timeline — a derived phase density bar (dry vs. wet media per month, from `classifyMedium()`
      in `src/lib/facets.ts` — no manual phase tagging). Originally its own `/timeline` page;
      folded directly into `/` on 2026-07-22 (see the home page redesign entry near the end of
      this file) — no longer a separate route.
- [x] non-JS `/browse` — plain list grouped by `location.placeName`. Removed outright on
      2026-07-22 per explicit feedback ("pointless, I'll never use it") — see the home page
      redesign entry near the end of this file.
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
- [x] Originally its own `/map` page (`src/pages/map.astro`); folded directly into `/` on
      2026-07-22 (see the home page redesign entry near the end of this file) — `mapPage.ts` and
      its `setupMap()` export are unchanged, just imported from `index.astro` instead.
- [x] `src/scripts/mapPage.ts`, Leaflet + free OSM tiles.
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
- [x] Cloudflare Zero Trust: Access application created (2026-07-22), self-hosted, hostname
      `klauria.art`, path `/admin*` (the wildcard is what makes it cover every admin subpath, not
      just the literal `/admin` index). Verified: an unauthenticated request to `/admin` returns a
      `302` straight into `untitledtrading.cloudflareaccess.com`'s login flow — the Worker never
      runs at all for a non-matching request, confirmed via `curl -D -` showing the redirect and
      `Set-Cookie: CF_AppSession`.
- [x] Configured Google as the identity provider: OAuth client created in Google Cloud Console
      (Web application type, authorized origin/redirect URI both under
      `untitledtrading.cloudflareaccess.com`), wired into Zero Trust → Authentication → Login
      methods, tested successfully via the dashboard's own "Test" button.
- [x] Access policy: single Allow policy, Include rule `Emails` = `kslauria@gmail.com` — the only
      account that can reach `/admin*` at all.
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
      favorites). `ADMIN_EMAIL` is now a real Worker secret (`kslauria@gmail.com`, set via
      `wrangler secret put ADMIN_EMAIL`, 2026-07-22) rather than the earlier empty-string `vars`
      placeholder — a secret can't share a binding name with a `vars` entry, so the placeholder was
      removed from `wrangler.jsonc` first. Since `wrangler types` only knows about `vars`/bindings
      declared in config, not secrets, `ADMIN_EMAIL` is no longer in the generated
      `worker-configuration.d.ts` at all — added back via a declaration merge in `src/env.d.ts`
      (augments both the top-level `Env` and `Cloudflare.Env`, since `cloudflare:workers`' `env`
      export is typed as the latter) so `astro check` still sees it as `string | undefined`.
      Verified: local dev writes still work unauthenticated (as before — Access doesn't exist
      locally so this check no-ops there, same as ever), and production `/admin` still gets the
      Access `302` (this check is defense-in-depth *behind* Access, not instead of it).
- [x] Purge-on-write — `src/lib/purge.ts`'s `purgeEverything()`, called after every successful
      mutation. Calls `cache.purge({ purgeEverything: true })` from inside the Worker (see the
      Cache fix entry below) — needs no external credentials at all, unlike the zone-level Cache
      Purge HTTP API this originally used. Best-effort/fire-and-forget — failures are swallowed,
      not surfaced, since a missed purge self-heals on the next write's purge regardless of what
      that write touched.

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

## Automated test suite (2026-07-21)
Added Vitest (`npm test`) and unit-tested every pure function in `src/lib/` — 57 tests, all
passing. Writing these actually caught two real, live bugs (not hypothetical):
- [x] **Inconsistent sort comparator, duplicated 5 times**: `(a, b) => (a.date < b.date ? 1 : -1)`
      returns `-1` for *equal* dates regardless of argument order, which is an invalid/inconsistent
      comparator — it can sort same-date pieces unpredictably depending on the sort algorithm.
      Found via a test asserting original relative order should be preserved for equal-date items.
      Fixed once as `compareDatesDescending()` in `src/lib/facets.ts` (returns `0` on equal dates)
      and used everywhere the old inline version was duplicated: `getPiecesByTag`,
      `getAssetsByKind`, `getPiecesByDateDescending`, `index.astro`'s "Recent" list (which was
      reimplementing `getPiecesByDateDescending` inline instead of calling it — now just calls it),
      and `admin/favorites.astro`'s date tiebreaker.
- [x] **Timezone-dependent painting count**: `getPaintingStats()` used `now.getFullYear()` (local
      time) instead of `now.getUTCFullYear()`, so "paintings this year" would use the wrong year
      depending on the executing machine's timezone relative to UTC — caught immediately by a test
      using a UTC midnight boundary date, which failed in this environment's local timezone.
      `piece.date` is a plain "YYYY-MM-DD" string with no timezone of its own and Workers run in
      UTC, so UTC is the only timezone-independent, consistent choice here. Fixed.
- [x] Test files, one per `src/lib/` module with real logic: `ids.test.ts`, `facets.test.ts`,
      `imageDimensions.test.ts` (built minimal-but-real PNG/JPEG byte buffers to test the header
      parser, including malformed/truncated/unrecognized-format edge cases), and `data.test.ts`
      (an in-memory mock R2Bucket exercising the *actual* conditional-write/retry logic — including
      the exact ETag-format distinction that caused the real crash fixed earlier this session, and
      a genuine concurrent-write-then-retry scenario, not just the happy path).
- [ ] Not unit-tested (deliberately, not an oversight): anything that's mostly Astro template
      markup/routing (the `.astro` page files themselves), the two client-side scripts
      (`pieceForm.ts`, `mapPage.ts` — DOM-dependent, would need a browser-like test environment to
      be worth it at this scale), and the admin write flows end-to-end (covered by manual
      curl-based verification during earlier development instead — see git history).
- [x] `scripts/check-caching.mjs` — see the Automated caching-behavior check entry in Phase 6
      below. Separate from the Vitest suite on purpose (needs a live deployed URL, not something
      `npm test` can exercise).
- Ran `npm audit`: 5 high-severity findings, all transitively from `sharp`/libvips inside
  `miniflare` (wrangler's local dev/emulation tooling) — a dev-only dependency chain that never
  ships in the deployed Worker (Workers run in an isolate, not Node; nothing native gets bundled).
  Deliberately not forcing `npm audit fix --force` (would downgrade wrangler to 4.15.2, a breaking
  change) for a vulnerability with no production exposure.

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
      header (`HIT` vs `MISS`/`BYPASS`/`EXPIRED`) via `curl -I` or browser devtools — the footer is
      a no-devtools-needed sanity check, not a replacement for that. Verified locally: valid UUID,
      changes on every reload as expected (local dev has no Workers Cache — this only means
      something once actually deployed).
- [x] Automated caching-behavior check — `scripts/check-caching.mjs` (plain Node `fetch`, no test
      framework, no dependency). **This is a post-deploy smoke test, not a CI/unit test** — it
      depends on real Cloudflare edge behavior (Workers Cache, `CF-Cache-Status`) that simply
      doesn't exist under local dev, so it can only mean something against the live deployed site.
      Usage: `node scripts/check-caching.mjs <url>`. Path list has changed twice as pages were
      folded into `/` or removed outright — currently `/` and `/kind/setup` (see the home page
      redesign entry near the end of this file). For each path: fetches it twice back to back and
      asserts, on the second response,
      `CF-Cache-Status: HIT`, an identical `data-render-id`, and a byte-identical body. This script
      is what caught the real caching bug — see the Cache fix entry below. Confirmed all-PASS
      against `https://31-art-website.klauria.workers.dev` after that fix (2026-07-22); expect the
      same once the custom domain is attached (cache behavior is per-Worker, not per-hostname, so
      no re-verification should be needed there, but worth one more run to be sure). Only worth
      covering one page per *kind* (not every `/piece/[id]`) since cacheability could in principle
      differ per route type, not per instance of the same route.
- [ ] Confirm phase/density chart reads well on the timeline
- [ ] Test the full admin flow on a phone (upload + retag + reorder favorites)
  - [ ] **Specifically check HEIC**: iPhones often save/share photos as HEIC by default. Our
        `getImageDimensions()` (src/lib/imageDimensions.ts) only parses PNG/JPEG — a HEIC upload
        wouldn't crash (dimensions just silently stay unset, already handled), but the bigger risk
        is that HEIC has poor `<img>` support outside Safari, so a HEIC-uploaded piece might not
        display for family/friends on Chrome/Firefox/Android. Whether this actually bites depends
        on whatever app/share-sheet gets the photo onto the device used for the admin form (iOS
        often auto-converts to JPEG in many sharing paths, but not always) — worth deliberately
        testing with a real HEIC file before assuming it's fine. If it is a problem: either always
        export/convert to JPEG before uploading, or add server-side transcoding (a real chunk of
        work — HEIC decoding is nontrivial, would likely need a WASM library or the Cloudflare
        Images product rather than anything hand-rolled).
- [x] **Gap found on review**: file uploads only checked `size > 0`, never validated that the file
      was actually an image — the `accept="image/*"` on the `<input>` is just a client-side hint,
      trivially bypassed (or just the wrong file picked by accident). Added a server-side check in
      both the new-piece and edit forms: any provided file whose `type` doesn't start with
      `image/` now fails validation with a clear message naming the field and the file's actual
      type, instead of silently uploading something an `<img>` tag can't render. Verified locally
      with a `.txt` file: rejected with a clear error, nothing written to R2.
- [ ] Deploy to production custom domain, confirm cold-region load behavior is acceptable

## Backups (2026-07-22)
Full design/rationale in docs/architecture.md's Backups section. Summary of what's built and
verified, all against real production data (created and cleaned up throwaway test pieces):
- [x] Second R2 bucket `31-art-website-backups` (`BACKUP_BUCKET` binding), append-only — nothing
      ever deletes from it.
- [x] On-write backup (`src/lib/backup.ts`) wired into every admin mutation (new piece, edit,
      delete, favorites reorder): every uploaded image copied to the backup bucket synchronously
      at upload time; every metadata write saves a timestamped, never-overwritten snapshot.
      Best-effort — failures are swallowed so a backup problem can never break the actual write.
      Verified: uploading a real piece on production immediately produced both an image copy and
      a metadata snapshot, visible on `/admin/backups`.
- [x] `backup-worker/` — a small, separate, plain Cloudflare Worker (deliberately not folded into
      the main Astro app's build — see architecture doc for why) with a daily Cron Trigger
      (`0 9 * * *`). Reconciles: checks every image referenced in the metadata has a backup copy
      and self-heals any gaps, takes a redundant metadata snapshot, writes a log entry. No public
      route (`workers_dev: false`) since it only needs its own schedule; verified by running it
      against real production data via `wrangler dev --remote` (not just local emulation) before
      and after deploying for real — correct output both times (`imagesChecked`, `imagesCopied`,
      `metadataSnapshotTaken`, `errors`).
- [x] **Follow-up per explicit feedback**: a single overwritten `status.json` wasn't enough — "I
      don't wanna have to go to the backups, I'm gonna forget it exists... here's the last 7-10
      backup jobs that were run." Reworked into a proper log: every backup-relevant event (each
      on-write backup from an edit, each daily reconciliation run) writes its own small,
      never-overwritten entry under `backups/log/` (`BackupLogEntry` in `src/lib/backup.ts`,
      `logBackupEvent()`/`getRecentBackupLog()`). `getRecentBackupLog()` paginates through the
      *entire* key listing rather than just R2's first-1000-per-call, so "most recent N" stays
      correct once the total count eventually exceeds that (a couple of years out, at this rate).
      **`/admin` itself now shows the last 10 events inline** (not just a link to go check) — a new
      shared `BackupLog.astro` component, also used by `/admin/backups` (last 50, plus the
      reconciliation health line and the full metadata snapshot list). Verified locally and
      end-to-end: an upload, an edit, and a delete each produced their own correctly-detailed log
      entry, immediately visible on `/admin` without navigating anywhere.
- [x] `/admin/backups` — still exists for the deeper view (per explicit request to keep it) —
      reconciliation health (flagged **STALE** if it's been notably longer than a day since the
      last reconciliation entry, which usually means the Cron Trigger stopped rather than a run
      failing — a run that fails for another reason still logs an entry with its errors listed),
      last 50 log entries, and the full metadata snapshot list (most recent 20 shown, total count
      via `countBackupSnapshots()`). Linked from `/admin`.
- [x] One real hiccup during setup: running `wrangler dev`/`deploy` from inside `backup-worker/`
      initially failed with a config conflict — it was picking up a stale deploy-redirect file left
      in the *root* project's `.wrangler/deploy/`, from the main site's Astro-adapter build
      redirect. Fixed by always passing `--config ./wrangler.jsonc` explicitly from within
      `backup-worker/` rather than relying on wrangler's directory auto-detection.
- [ ] Explicitly out of scope for now (a strictly bigger, different threat model — "the whole
      Cloudflare account is compromised/suspended" rather than "a bug in this app's own code"): an
      off-Cloudflare copy of the backups. Worth considering later if wanted.
- [ ] No pruning/retention policy on metadata snapshots (kept forever) since the cost is
      negligible at this document's size — revisit only if this stops being true after years of
      real use.

## Cache fix: Workers Cache, not Cache Rules (2026-07-22)
The entire caching design up to this point was built on a wrong assumption, caught live: after
configuring a Cache Rule per a dashboard walkthrough, `node scripts/check-caching.mjs
https://klauria.art` still FAILed on every path — `CF-Cache-Status` absent entirely, render ids
changing on every request.
- [x] Root cause, confirmed via direct research: zone-level Cache Rules only apply to a Worker's
      own `fetch()` calls to an external origin — they never apply to a Worker that generates its
      response directly, which is this app's entire case (Astro renders straight from R2, no
      origin fetch involved). No Cache Rule configuration could ever have made this work.
- [x] Also confirmed: the original purge-on-write mechanism (zone-level Cache Purge HTTP API via
      `CF_API_TOKEN`/`CF_ZONE_ID`) would not have purged the correct cache either way — per
      Cloudflare's own docs, "no zone-level purge (via the dashboard, API, or Terraform) affects
      Workers Caching content."
- [x] Correct mechanism: **Workers Cache** (`"cache": { "enabled": true }` in `wrangler.jsonc`,
      requires Wrangler ≥4.69.0 — this project has 4.113.0) — a cache in front of the Worker
      itself, so a hit never runs the Worker at all. Automatically respects the `Cache-Control`
      headers already set on every page, with zero code changes. Purging uses `cache.purge()`
      (imported from `'cloudflare:workers'`), called from inside the Worker — needs no API token.
- [x] Net simplification, not just a fix: the previously-required "create a Cache-Purge-scoped API
      token" manual step is gone entirely — `CF_API_TOKEN`/`CF_ZONE_ID` removed from
      `wrangler.jsonc`'s `vars`.
- [x] Fixed: `src/lib/purge.ts` rewritten around `cache.purge({ purgeEverything: true })`, its
      3 call sites (`admin/new.astro`, `admin/edit/[id].astro` ×2, `admin/favorites.astro`) updated
      to the new no-argument signature, `wrangler.jsonc` updated (`cache.enabled: true` added,
      `CF_API_TOKEN`/`CF_ZONE_ID` removed), types regenerated, `astro check` clean, all 57 Vitest
      tests still passing, deployed, and reverified: `check-caching.mjs` now reports all-PASS
      against `https://31-art-website.klauria.workers.dev`, and `/admin` correctly shows
      `CF-Cache-Status: BYPASS` (its `no-store` header is respected as expected).
- [x] docs/architecture.md's Cache policy section and this file corrected to describe Workers
      Cache instead of the old Cache-Rules-based design.

## Home page redesign: image-forward, one continuous scroll (2026-07-22)
Prompted by explicit visual feedback after the first working deploy: dark mode was never asked
for, the top nav broke onto an ugly second line on mobile, thumbnails were tiny text-led list rows
("the name is bigger than the image. no."), and the site overall didn't feel like it was actually
about visual art. Also compared directly against a real painter's Squarespace site (Judd Mercer)
to calibrate scale: "BANG, fullscreen images," not a modest thumbnail grid.
- [x] Removed the `@media (prefers-color-scheme: dark)` block from `Base.astro` entirely — the
      site is always the light/cream palette now, never auto-switches.
- [x] Removed the global `img { border: 2px solid var(--border) }` rule — no border around
      artwork anywhere, matching the reference site.
- [x] Nav mobile fix: changed `flex-wrap: wrap` to `overflow-x: auto` with `white-space: nowrap`
      on the links — a single horizontally-scrollable row at every width instead of wrapping.
- [x] `PieceList.astro` rebuilt from a plain `<a><PieceThumb/>title</a>` list into an image-led
      card grid (`src/components/PieceList.astro`), used by `/`, `/tag/[slug]`, and the home
      page's various sections (and `/browse`, since removed — see the follow-up entry below).
      Normal size: a responsive `auto-fill` grid, modest square-cropped cards — fine for "browse
      many things" list contexts.
- [x] Added a `large` variant, iterated twice after seeing it live: first attempt was a modest
      `minmax(220px)` grid — too small. Second pass: full viewport width (breaks out of the
      page's centered container via the standard `left:50%; margin-left:-50vw` trick), natural
      (non-cropped) aspect ratio per image, single column. Still not enough per explicit
      follow-up ("HUGE we want it HUGE"). Final shape, after being shown Judd Mercer's site
      directly: `repeat(auto-fit, minmax(480px, 1fr))` with the *first* piece forced to
      `grid-column: 1 / -1` — one massive opening image, then naturally 2-3 per row on a wide
      desktop window, back down to 1 per row on mobile. No JS, no breakpoints hand-written —
      the auto-fit/minmax combination does this on its own.
- [x] **`/map` and `/timeline` are no longer separate pages.** Both folded directly into `/`:
      the home page is now one continuous scroll — big images (favorites, then recent) → the
      interactive Leaflet map → the phase/density timeline chart → more big images (rediscover) →
      the lifetime/year stat at the very bottom. `src/pages/map.astro` and
      `src/pages/timeline.astro` deleted outright (not just unlinked) — keeping two ways to reach
      the identical content would just be duplicate code to keep in sync, and nothing asked to
      keep them independently reachable. `mapPage.ts`'s `setupMap()` and the phase/density
      grouping logic from the old `timeline.astro` are unchanged, just relocated into
      `index.astro`. Nav no longer links to either. Updated the stale links this broke:
      `404.astro`'s suggestions, `browse.astro`'s "see the map" hint (before `/browse` was itself
      removed — see the follow-up entry below), and `scripts/check-caching.mjs`'s path list.
- [x] Replaced the never-populated `pinnedLinks` admin-editable quick-links concept with one
      hardcoded link on the home page ("My easel setup" → `/kind/setup`) — see the standing
      simplicity-audit item near the top of this file for the follow-up to remove the now-dead
      `pinnedLinks` field/type entirely.
- [x] The "Favorites" section lost its heading entirely per explicit feedback ("favorites doesn't
      need to say favorites") — it's just the first big-image section on the page, unlabeled,
      falling back to recent pieces when there are no favorites set yet.
- [x] Moved the lifetime/year painting-count stat from a boxed callout near the top to a small
      muted line at the very bottom of the page — explicitly "a stat I wanna look at," not
      something a visitor needs first.
- [x] Verified after every step against local dev (real HTML/CSS inspection of the rendered page,
      not guessed) before each deploy, plus the full `astro check` / Vitest / build /
      `check-caching.mjs` cycle each time.

## Home page redesign, round 2: mobile bugs and more exploration tools (2026-07-22)
More explicit feedback after actually using the redesigned site on a phone.
- [x] **Real bug, not just a preference**: the `large` gallery's `minmax(480px, 1fr)` set a
      *minimum* column width wider than most phone screens, forcing the whole grid — and the
      image inside it — past the edge of the viewport. That's what showed up live as "the image
      is cut off, you have to scroll horizontally to see it all." Fixed with
      `minmax(min(480px, 100%), 1fr)`, which caps the minimum at whatever width the screen
      actually has.
- [x] **Real bug**: map pins showed as a broken-image box with cut-off text instead of an actual
      pin. Leaflet's default marker icon resolves its image relative to its own CSS file, which
      breaks once bundled by Vite — the standard fix (explicitly importing the marker PNGs and
      calling `L.Icon.Default.mergeOptions()` with the bundler-resolved URLs) is now in
      `mapPage.ts`.
- [x] Map no longer auto-zooms/fits bounds to wherever the pieces happen to be — removed the
      `map.fitBounds()` call entirely. It now always opens on the same wide world view
      (`setView([20, 0], 2)`) and the viewer zooms in themselves.
- [x] Header rebuilt again: a full nav bar + a heavy underlined `<h1>` + a quick-links button were
      all sitting above the first image ("SO SO SO MUCH SPACE... the priority is THE IMAGES").
      Replaced with a compact site-title + a hamburger toggle (a plain checkbox/label pair, no
      JS) that reveals the nav links as a small dropdown — same pattern as Judd Mercer's mobile
      header, which was pointed to directly as the reference. The global `h1` style also shrunk
      site-wide (no border, much smaller) since other pages (piece/tag/kind) still use a real
      `<h1>` for their own distinguishing title.
  - [x] "Browse" and "Admin" removed from the hamburger dropdown too. `/browse` deleted outright
        ("pointless, I'll never use it" — same reasoning as the `/map`/`/timeline` removal: don't
        leave dead routes lying around). "Admin" moved down next to the render-id debug footer,
        styled to blend into that same muted line, since "only I will ever click it."
- [x] `/kind/[kind]` (e.g. "My easel setup") was still the old tiny-thumbnail list — rebuilt to
      use the same `piece-grid large` treatment as the home page. Since this page's data is
      `{piece, asset}` pairs (a specific matching asset per piece, not necessarily the piece's
      overall primary/final asset), the shared grid CSS was pulled out of `PieceList.astro`'s
      scoped `<style>` into `Base.astro`'s global stylesheet, keyed by class name — one shared
      look, usable by markup that doesn't share `PieceList`'s `Piece[]`-shaped props.
- [x] "N paintings in your lifetime" → "in my lifetime" — this is the artist's own site, written
      in their voice, not addressed to the visitor.
- [x] Added a tag cloud section ("a way for the viewer to see all the tags that exist and click
      them") below Timeline — reuses the existing `getTagFrequency()` (already built for the
      admin form's tag-suggestion chips), rendered as `tag-chip` links sized on a simple linear
      scale between the least- and most-used tag, linking to `/tag/<slug>`.
- [x] Restructured the home page so real art keeps appearing between the exploration tools
      instead of one image block up top followed by Map/Timeline/Tags back to back: favorites →
      recent (first half) → Map → recent (second half) → Timeline → a random pick → Tags →
      another random pick → the lifetime stat. "A user comes in and it's like they're surrounded
      by my images, and then there's ways for them to enter in and see more" — by location, by
      time, or by tag. Dropped the "Recent"/"Rediscover" headings on these image batches entirely
      now that there are several of them — keeping section headings only on the three tools
      (Map/Timeline/Tags), which are genuinely distinct destinations, not just more art.
- [x] **Found mid-fix, not something originally designed for**: a pure code deploy (no admin data
      write) never calls `purgeEverything()`, since that only ever fires from inside an
      authenticated admin write handler. Caught live — a deleted `/map` route kept serving its
      old page from a still-warm Workers Cache entry, aging well past the deploy that removed it.
      Added `src/pages/deploy-purge.ts`, a GET endpoint gated by a `DEPLOY_PURGE_TOKEN` Worker
      secret (not Cloudflare Access, since this needs to be callable from a deploy script/CLI
      session rather than a browser login) that just calls `purgeEverything()`. 404s on any token
      mismatch or if the secret isn't set. Called once after every deploy since. Worth deciding
      whether to keep this as standing infrastructure or remove it later.
      **Lesson learned re-confirmed several times since**: purge propagation is not instant —
      several post-deploy checks showed a stale `CF-Cache-Status: HIT` for 15-30+ seconds after
      calling `/deploy-purge`, before a re-check finally showed `MISS` with the new content. Don't
      trust the first post-purge check alone; wait ~25-30s and re-verify before concluding
      something didn't deploy.

## Home page redesign, round 3: timeline scrubber, real map clustering, admin conveniences (2026-07-22)
- [x] **Timeline scrubber**: replaced the static per-month stacked-bar list with an interactive
      one — a native `<input type="range">` (one step per month, oldest on the left, so dragging
      it is the "scrubbing," no hand-rolled drag/pointer JS needed) whose own track background is
      a server-computed gradient colored by that month's dry/wet-media mix (reusing
      `classifyMedium()`), plus a small gallery frame below showing the selected month's primary
      image with `‹`/`›` buttons to page through multiple pieces in the same month. New
      `src/scripts/timelineScrubber.ts`, same `setupX()`-export pattern as `mapPage.ts`. Per-piece
      image data for the frame is embedded as a `<script type="application/json">` tag exactly
      like the map's piece data.
- [x] **"Second image in Recent looks smaller than the first" — not a bug, but a rule applied too
      broadly.** The Judd-inspired "first piece spans the full row" treatment
      (`.piece-grid.large > li:first-child`) was firing independently in every big-image batch on
      the page (favorites, recentA, recentB, rediscoverA, rediscoverB), not just the page's actual
      opening image — so every batch "restarted" the big-then-smaller pattern, which reads as
      broken sizing rather than a deliberate one-time opening beat. Added a `heroFirst` prop to
      `PieceList.astro` (only true for whichever of favorites/recentA actually renders first);
      the CSS rule now requires a `.hero-first` class instead of firing unconditionally on every
      `.piece-grid.large`.
- [x] **Filename-derived date, alongside the existing filename-derived title**: selecting the
      final image now also tries to parse a date out of the filename (`YYYY-MM-DD`/`YYYY_MM_DD`,
      or a bare `YYYYMMDD` run — the common phone-camera pattern, e.g.
      `IMG_20231114_153022.jpg`) and pre-fills the date field with it. The date field is never
      genuinely empty like the title field is (new pieces default to today, edits show the real
      date), so "only fill if empty" doesn't work here — instead tracks the value as it stood at
      page load and only overwrites while it's still exactly that, same pattern already used for
      the reverse-geocoded place name.
- [x] **Location search** ("type and search... like Prospect Park, not have to click the map"):
      added a text input + Search button next to the map in both admin forms. Forward-geocodes via
      the same Nominatim service already used for reverse geocoding (no new dependency), takes the
      single best match (no picker UI for ambiguous results — not worth it for a single-editor
      tool searching an obvious named place), then reuses the existing `setLocation()` helper to
      drop the pin/pan the map/fill the place name, so it's indistinguishable from a manual click
      once the result comes back.
- [x] **Real bug: portrait/tall images rendered too big to see on screen, worst on `/piece/[id]`**.
      The image style was `max-width:100%; height:auto` — no height cap at all, so a tall scan at
      full container width could render many multiples of the viewport's height. Fixed by adding
      `max-height:85vh` alongside (`width:auto; height:auto` on both axes lets the browser fit
      within whichever bound is tighter, standard "contain" behavior for a plain `<img>`). Fixed
      in both `piece/[id].astro` and the map's inline detail panel (`mapPage.ts`'s `renderDetail`,
      same underlying style string).
- [x] **Map: pieces at the same location merging into what looked like one marker.** This took
      three attempts to get right, worth recording all three since the first two seemed reasonable
      going in:
      1. Grouped by lat/lng rounded to ~11m and gave the group a numbered badge. **Failed in
         practice** — pieces someone considers "the same place" (e.g. both at "Prospect Park") are
         very often clicked at noticeably different spots on a zoomed-out map, easily well outside
         11m of each other, so this basically never fired.
      2. Switched the grouping key to the piece's `placeName` string instead. **Explicitly
         rejected by the owner** — this only solves "same named place," not the actual ask, which
         turned out to be **dynamic, zoom-dependent merging**: two pieces on opposite sides of a
         city should merge into one badge at world zoom (a few screen pixels apart) but split back
         into individual pins once zoomed into that city (hundreds of pixels apart). No fixed key
         computed once from the data can do that — it has to be recomputed live from the map's
         actual current pixel geometry every time the zoom changes.
      3. **Correct fix**: added `leaflet.markercluster` (`npm install leaflet.markercluster
         @types/leaflet.markercluster`) — real pixel-distance clustering that recomputes on
         zoom/pan, shows a count bubble, splits automatically on zoom-in, and "spiderfies" (fans
         out into individually-clickable satellite markers) a cluster that still has multiple
         pieces once you're zoomed in as far as possible, which is what handles pieces at the
         literal same point without needing any custom prev/next paging UI. This also *simplified*
         `mapPage.ts` back down from the manual-grouping version — one marker per piece again, no
         custom grouping/centroid/paging code, the library owns all of that. Recolored the
         library's default green/yellow/orange size-tier bubbles to the site's pink/mono palette.
      - **Bundler quirk hit along the way**: `import 'leaflet.markercluster/dist/MarkerCluster.css'`
        (the identical pattern already working for `leaflet/dist/leaflet.css`) silently produced no
        CSS output at all — confirmed it wasn't a typo/path issue by pointing the import at a
        deliberately nonexistent filename, which correctly errored the build (proving the real path
        *does* resolve), yet the real files' content never reached any emitted CSS chunk even after
        a full cache-clear (`node_modules/.astro`, `node_modules/.vite`, `dist`) and rebuild.
        Worked around it by inlining the plugin's small, stable base CSS directly into
        `Base.astro`'s global stylesheet instead of importing it from the package — acceptable
        since that CSS essentially never changes, at the minor cost of not auto-picking-up a
        future library update to it.
- [x] Verified every item above against local dev first, then the full `astro check` / Vitest /
      build cycle, then deployed and reverified on production (including the two failed-then-
      corrected map approaches — each was actually deployed and checked before being told it was
      wrong and replaced, not just designed on paper).

## Home page redesign, round 4: naming, small polish, a real dedup bug (2026-07-22)
- [x] Site renamed "Sketches & Paintings" → "Lauria's Sketchbook" everywhere it appeared (header
      site-title, page/tab title, OG title).
- [x] Added the intro blurb ("I draw and paint from life, in a sketchbook. It's how I look at
      things.") right before the first gallery on the home page, and reused the same text as the
      default meta/OG description — mirroring how juddmercer.art's own bio blurb doubles as its
      description.
- [x] Admin: swapped section order so **Pieces** now renders above **Backups** (was the reverse).
- [x] Footer: added an "Add new piece" link right next to Admin, so uploading one piece and then
      immediately wanting to add another doesn't require navigating away first.
- [x] Hamburger nav: added "High Sierra Trip" alongside "My easel setup", linking to
      `/tag/sierra%20trip` (`encodeURIComponent('sierra trip')`) — same fixed-link pattern, no new
      mechanism needed.
- [x] **Real bug: Favorites/Recent/Rediscover could all show the same piece more than once on the
      home page.** The `shown` id-tracking set used to exclude duplicates across Recent/Rediscover
      batches was never seeded with favorites' ids, and Recent was sliced directly from the full
      date-sorted list rather than a favorites-excluded pool — so a piece that was both a favorite
      and recent (very plausible, especially with few total pieces) appeared twice. Fixed by
      seeding `shown` with favorites first and deriving Recent's pool by filtering out anything
      already shown, before slicing. `allByDate` itself stays the complete, unfiltered list, since
      the Timeline still needs every piece regardless of favorite status.
- [x] Background changed from cream (`#f4f2ec`) to white; the shared `--gutter` bumped from `4vw`
      to `6vw` for a bit more breathing room on desktop. Deliberately did **not** touch `body`'s
      `max-width` to get more padding — that's the exact variable that caused the earlier
      text/image alignment bug, so only `--gutter` (which both `body`'s padding and the gallery's
      inset already reference) was touched, keeping the two locked together by construction rather
      than by coincidence.

## Image resizing: a small fixed set of buckets via the Images binding (2026-07-22)
Every image on the site was the original full-resolution upload, always, everywhere — a 140px
thumbnail and the full-bleed hero image both shipped the exact same bytes, with the browser doing
all the downscaling. Prompted by a direct question ("are we doing the thing where Cloudflare
resizes images automagically... or is that not happening anywhere rn") — it wasn't.
- [x] **Corrected the original plan from early in the project**: the assumption on record
      (docs/architecture.md, docs/TODO.md Phase 3) was Cloudflare Image Transformations via the
      `/cdn-cgi/image/width=...,format=auto/...` URL-rewriting pattern, deferred specifically
      because that mechanism only works on the real deployed edge, not local dev. Turns out
      there's a different, newer mechanism already halfway wired in without anyone asking for it:
      the Cloudflare **Images binding** (`env.IMAGES`) — confirmed present in the generated deploy
      config (`{"images":{"binding":"IMAGES"}}`) even though nothing in this project's own
      `wrangler.jsonc` declares it; the `@astrojs/cloudflare` adapter auto-provisions it (likely
      for its own `astro:assets` pipeline — the same auto-provisioning that caused the Leaflet
      marker-icon PNG-import bug earlier this session). Confirmed via direct doc research that this
      binding **does** work in local dev's "low-fidelity" mode for exactly what's needed here
      (`width`/`height`/`rotate`/`format`), unlike the URL-based approach — this is what actually
      unblocked building it now instead of continuing to defer it.
- [x] Three fixed size buckets (`src/lib/images.ts`'s `SIZE_WIDTHS`), not one arbitrary width per
      container — `thumb` (240px), `card` (1000px), `big` (1800px). Named "big," not "full," on
      explicit correction — "full" reads as "the original," which this deliberately is not.
      Keeping the bucket set small and fixed matters for cost/cache reasons: Cloudflare Images
      bills, and Workers Cache caches, each unique (source image, size) combination separately, so
      an arbitrary per-breakpoint width would fragment across far more variants than needed.
- [x] `imageUrl(r2Key, size)` — `size` is **required**, no default, so every call site is a
      deliberate choice: `thumb` for admin's `PieceThumb` and the map's hover popup; `card` for the
      big gallery grid everywhere it appears (including the OG/Twitter image); `big` for
      `/piece/<id>`'s main view, the map's inline detail panel, the timeline gallery frame, and
      specifically the one `heroFirst` opening image (it renders far larger than an ordinary card,
      so a card-sized source would look soft blown up that wide).
- [x] **The true, untransformed original stays reachable** — `/img/<r2Key>` with no `size` query
      param is completely unchanged from before this feature (`originalImageUrl()` in
      `src/lib/images.ts`). A "View full resolution" link now appears next to every asset on
      `/piece/<id>`, pointing straight at it. Public, not admin-gated — this is a personal archive,
      not a print-sales site, and anyone wanting real brush detail (or the artist wanting their own
      file back) shouldn't need to log in for it.
- [x] `src/pages/img/[...key].ts` extended: a valid `?size=` on an image content-type runs
      `env.IMAGES.input(object.body).transform({width, fit: 'scale-down'}).output({format:
      'image/webp'})`; anything else (no param, invalid value, non-image content-type, or the
      transform throwing) falls through to the untouched original. On a transform failure
      specifically, re-fetches a fresh R2 object rather than reusing `object.body`, since a failed
      transform may have already partially consumed that stream — returning it as-is at that point
      risked a truncated response.
- [x] Verified locally first (content-type changed `image/png` → `image/webp`, and the actual
      output pixel dimensions — checked directly, not assumed — matched the requested bucket
      width exactly), then against real production content: a genuine 5,011,202-byte / 5697×4007
      iPhone photo came back at 2,125,324 bytes for `big` (−58%), 745,980 for `card` (−85%), and
      47,878 for `thumb` (−99%).
- [x] `env.IMAGES` typed via the existing `src/env.d.ts` declaration-merge pattern (same approach
      already used for `ADMIN_EMAIL`/`DEPLOY_PURGE_TOKEN`) — `ImagesBinding` itself is already
      ambient from the Cloudflare Workers types, just needed adding to `Env`/`Cloudflare.Env`.

## Phase 7 — Content migration
Owner is doing this manually via `/admin/new`, not an agent task.
