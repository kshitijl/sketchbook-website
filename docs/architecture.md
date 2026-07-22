# Architecture

A website cataloging years of on-location sketches/paintings (NYC, Providence, India trips, national
parks) for the artist, their family, and friends. The core tension it's designed around: the site must
be **static-fast** for every viewer (snap-open on a phone anywhere in the world, no spinner, minimal
JS) while still being **easy to edit** every few days (upload a new piece, retag things, reorder
favorites) **without a git-commit-and-redeploy step**.

## Constraints and decisions

- **Scale**: 500–1,000 total images/pieces. Metadata is small; individual **image files can be large**
  (up to ~20MB PNG scans) — the image pipeline, not the metadata store, is the real design problem.
- **Editors**: one person only.
- **Map**: real interactive pan/zoom, clickable pins, hover preview, click-to-load full detail inline.
  JS is accepted here, with graceful degradation elsewhere.
- **Rendering**: Astro, in SSR mode via its official Cloudflare adapter. Not a hand-rolled Worker
  framework, not full client-side rendering, not Hono (single-author-originated, too new to be a
  foundational dependency here).
- **No htmx**: the one spot needing client interactivity (map → inline piece detail) uses a small
  amount of hand-written vanilla JS instead of an added dependency.
- **Auth**: Cloudflare Access, Google as the identity provider, policy locked to the owner's email.
- **Data model**: assets (photos/scans) attach to a piece and are tagged by kind, including
  setup/environment photos (not a separate top-level entity). Every piece requires at least an
  approximate location. Trips and medium are both just tags (open, multi-valued, no special fields).
  `stage` (finished vs. study/sketch) is the one dedicated single-select field, since it's a
  one-per-piece classification rather than an open multi-valued one. No draft/private state —
  uploading makes something immediately live.
- **Cache invalidation**: no manual "which pages does this affect" computation, and no reliance on
  TTL expiry either — every admin write purges the Worker's own cache in full. See **Cache policy**
  below for why that's better than either alternative.
- **No special-cased pages per asset kind** — one generic `/kind/<kind>` template, the same
  generalization already used for `/tag/<slug>`.

## Hosting & rendering: Astro SSR on Cloudflare

One Astro project, deployed via `@astrojs/cloudflare` to a Cloudflare Worker, on a custom domain.
Two build steps exist and must not be conflated:

1. **Deploying the app's code** (Astro components, CSS, the map island's JS) — a normal
   `wrangler`/CI deploy, done when the site's code or design changes. Rare, deliberate.
2. **Rendering one page for one viewer's request** — happens live, inside the Worker, on a cache
   miss, reading whatever data currently exists in R2. Adding a painting only ever triggers this,
   never a redeploy of app code. On a cache hit, the Worker doesn't run at all; Cloudflare serves the
   cached HTML directly.

Non-interactive pages are plain Astro components — zero JS shipped to the browser by default. Two
**islands** on the home page hydrate and ship their own JS: the Leaflet map, and the timeline
scrubber (see their own sections below).

**Request walkthrough** (e.g. a viewer opening `/piece/042`):
1. Cloudflare's anycast network routes to the nearest edge PoP.
2. Cache hit (the common case — see **Cache policy** below): served straight from Workers Cache,
   sub-10ms, Worker never runs at all.
3. Cache miss (right after a purge, or a fresh Worker version's first request anywhere): the Worker
   runs, Astro renders the page from the current data in R2, response goes out with `Cache-Control`,
   and gets cached.
4. Workers Cache is tiered: each data center has its own local cache, but they all consult a shared
   upper tier on a local miss — so the very first request for a page, from anywhere on Earth, is
   generally enough to make every later request everywhere a hit, without waiting for that specific
   data center to see its own first visitor.

## Metadata storage: one JSON document in R2

A single object, `data/pieces.json`, holding:

```json
{
  "pieces": [ { "...piece record...": true } ],
  "pinnedLinks": []
}
```

`pinnedLinks` is dead weight at this point — there was never an admin UI to write it, and as of
the 2026-07-22 home page redesign nothing reads it either (the one thing it was ever meant to hold,
an "Easel Setup" quick link, is now just hardcoded directly in the header nav, since building a
whole editable-links feature for two or three fixed destinations was never worth it). Still present
in the type/stored document only because removing it hasn't been done yet — see docs/TODO.md's
standing simplicity-audit item.

At ~1,000 pieces with generous fields, this is roughly 1-2MB uncompressed / a few hundred KB gzipped —
cheap to read, cheap to write, cheap to ship to the browser whole for the map/timeline islands.

**Piece record shape:**

```json
{
  "id": "2023-india-jaipur-001",
  "title": "Hawa Mahal, morning light",
  "date": "2023-11-14",
  "stage": "finished",
  "location": { "lat": 26.9239, "lng": 75.8267, "placeName": "Jaipur, India" },
  "tags": ["india-2023", "watercolor", "ink", "architecture"],
  "notes": "Free text — the artist's own commentary on the piece.",
  "favoriteRank": 3,
  "assets": [
    { "id": "a1", "kind": "final", "r2Key": "assets/2023-india-jaipur-001/a1-v1.png", "width": 0, "height": 0 },
    { "id": "a2", "kind": "reference-photo", "r2Key": "...", "width": 0, "height": 0 },
    { "id": "a3", "kind": "value-study", "r2Key": "...", "width": 0, "height": 0 },
    { "id": "a4", "kind": "setup", "r2Key": "...", "width": 0, "height": 0, "caption": "easel + travel palette" }
  ]
}
```

- `stage`: `"finished" | "study"` — one-per-piece classification, not a tag.
- `favoriteRank`: `number | null` — `null` means not a favorite; a number is its position in the
  favorites list.
- `tags`: open vocabulary, multi-valued. Medium (watercolor, ink, oil, gouache, pencil, acrylic) and
  trips (e.g. `india-2023`) both live here — structurally identical (a piece can have several of
  either), so no reason to special-case them into their own fields.
- `assets[].kind`: `final | unsorted | reference-photo | in-progress | value-study | setup` — extend
  freely; a new kind is just a new string value, never a schema migration. `unsorted` is the
  fallback kind for an "additional photo" that somehow gets uploaded without a real kind picked (see
  **Admin form conveniences** below for the normal path, where a kind is chosen at upload time).

Why `stage` gets its own field when medium/trips don't: `stage` is single-select (a piece just *is*
finished or a study, never both), which an open `tags` array can't enforce — a real structural
difference, not an arbitrary one.

**Write flow** (every admin action — upload, edit, retag, reorder favorites):
1. Cloudflare Access has already verified the editor at the edge before this handler runs at all.
2. Worker reads `data/pieces.json` from R2, keeping its current ETag.
3. Applies the change in memory.
4. Any new/replaced image bytes get written to R2 under a fresh versioned key
   (`assets/<piece-id>/<asset-id>-v2.png`, never reused) — this sidesteps image cache invalidation
   entirely; old keys just stop being referenced.
5. Writes the updated JSON back with a conditional PUT (`onlyIf: {etagMatches: ...}`) — if it fails
   because something wrote in between, reload and retry.
6. Calls `cache.purge({ purgeEverything: true })` (see `src/lib/purge.ts`) to invalidate the
   Worker's own cache in full. No list of "affected pages" to compute — a full purge is
   indiscriminate by design, which is what makes it bug-free: there's nothing to forget.

## Cache policy: purge-on-write, not TTL-driven expiry

Every HTML page and the shared `data/pieces.json` fetch carries the same `Cache-Control`:

```
Cache-Control: public, max-age=60, s-maxage=2592000
```

**This is read by Workers Cache** (`"cache": { "enabled": true }` in `wrangler.jsonc`, requires
Wrangler ≥4.69.0) — a cache that sits in front of the Worker itself, so a hit is served without the
Worker running at all. This is a real correction from an earlier design: ordinary zone-level Cache
Rules were assumed to be the mechanism here, but **Cache Rules only apply to a Worker's own
`fetch()` calls to an external origin** — they do nothing for a Worker that generates its response
directly (this app's entire case, since Astro renders straight from R2 with no origin fetch
involved). This was caught live: a post-deploy smoke test (`scripts/check-caching.mjs`) against
production showed every page re-rendering on every request — `CF-Cache-Status` absent entirely —
despite a correctly-configured Cache Rule. Workers Cache is the mechanism that actually works for a
Worker acting as its own origin, and needs zero dashboard configuration — just the one config flag.

Two things read the `Cache-Control` header, for different purposes:

- **`s-maxage` (Workers Cache, 30 days)**: this is what actually governs how often Astro's render
  code reruns. It's long because *purge*, not expiry, is what keeps the cache fresh — step 6 of the
  write flow invalidates it the instant something changes. A missed/failed purge is self-healing:
  the next edit purges everything again regardless of what it touched. In steady state, Astro only
  reruns for two reasons: the request immediately after a purge (guaranteed miss), or a fresh
  Worker version's first request (the Worker version is part of the cache key, so each deploy
  starts with an empty cache).
- **`max-age` (the visitor's own browser, 1 minute)**: a server-side purge has zero effect on a
  browser's already-cached local copy — there's no way to remotely invalidate that. Kept short
  (rather than, say, an hour) mainly so the site owner can debug the live site without constantly
  clearing their own browser cache; a re-ask this frequent is cheap regardless, since it's just
  browser-to-edge traffic and the edge already has the fresh, purged-and-rerendered response cached
  and ready — this value has no bearing on how often Astro's render code actually runs.

Purging calls `cache.purge()` (imported from `'cloudflare:workers'`) **from inside the Worker** —
this needs no API token or zone ID at all, unlike the zone-level Cache Purge HTTP API. That's
actually the important part of the correction: per Cloudflare's own docs, "no zone-level purge (via
the dashboard, API, or Terraform) affects Workers Caching content" — only this in-Worker call does.
The zone HTTP API this app used to call had no effect on Workers Cache whatsoever, meaning the
original purge-on-write design was silently a no-op even before the missing-Cache-Rule issue was
found. Images are unaffected by any of this — they stay long-cached/immutable, since they're
already invalidation-free by virtue of versioned keys.

**Things that silently bypass Workers Cache** (worth knowing if a page mysteriously stops caching):
only `GET`/`HEAD` requests are cached; a `Set-Cookie` response header forces `BYPASS`; requests
carrying `Authorization` only cache if the response is `public`, `must-revalidate`, or has
`s-maxage`; `Cache-Control: private`/`no-store` (used deliberately on every `/admin/*` route) always
bypasses.

**Verifying it's actually working**: the precise signal is the `CF-Cache-Status` response header
(`HIT` = served from cache, Worker didn't run; `MISS`/`BYPASS`/`EXPIRED`/etc. = it did) — check via
`curl -I` or the browser's Network tab. For an always-visible, no-devtools-needed sanity check,
every page also renders a small debug footer (see Base.astro) showing the render timestamp and edge
colo — if reloading the same URL keeps showing the same timestamp, that request was served from
cache, not re-rendered.

**A real gap found after this design was already live**: `purgeEverything()` only ever runs from
inside an authenticated admin write handler — a pure code deploy with no accompanying data edit
never purges anything. Caught live when a route removed in a deploy kept serving its old,
now-nonexistent page from a still-warm cache entry, well past when that deploy went out. Since
deploying happens from a CLI session with no Cloudflare Access login, the existing purge-on-write
path can't be reused directly — `src/pages/deploy-purge.ts` is a small GET endpoint gated by a
`DEPLOY_PURGE_TOKEN` Worker secret instead (404s on any mismatch or if the secret isn't set, so its
existence isn't advertised), called once after every deploy since. **Purge propagation is also not
instant in practice** — repeatedly confirmed a stale `HIT` for 15-30+ seconds after calling it,
before a re-check finally showed a fresh `MISS`. Don't trust the first post-purge check; wait ~25-30s
and re-verify.

## Backups

R2 has no native object/bucket versioning (still just a feature request, not a real feature —
checked directly, not assumed) and no snapshot mechanism resembling ZFS/LVM. R2's own advertised
durability (eleven 9s annually) is real but addresses a different problem than what this section is
for: it's a guarantee against *infrastructure* failure, and explicitly **not** against intentional
or accidental *deletion* — which is exactly the risk (a bug in this app's own code, or a stray
dashboard click) that backups here are meant to cover.

One relevant fact already true by construction: the admin app **never calls `.delete()` on an image
object**. "Remove this image" and "delete this piece" only ever edit the JSON pointer document
(`data/pieces.json`) — the underlying R2 bytes are simply de-referenced, never destroyed. So the
real risk is concentrated almost entirely in the metadata document itself (tags, titles, notes,
locations, favorite ranks, and the asset-id → r2Key links tying pieces to their images) — if that
JSON gets corrupted or wrongly overwritten by a bug, the raw image bytes might still physically
exist in R2, but disorganized and hard to find without the manifest that ties them together.

**Design**: a second R2 bucket (`31-art-website-backups`, bound as `BACKUP_BUCKET`), append-only —
nothing ever deletes from it, specifically so an accidental delete on the primary bucket can't
propagate into destroying the backup copy too. Two independent mechanisms feed it:

1. **On-write (immediate)** — `src/lib/backup.ts`, called directly from every admin write handler
   alongside the existing `purgeEverything()` call:
   - Every uploaded image is also written to the backup bucket under the same key, synchronously,
     in the same request, using the bytes already in memory from the upload — no separate sync job,
     no delay, no window of vulnerability between upload and next backup run.
   - Every metadata write also saves a full, timestamped, **never-overwritten** snapshot
     (`backups/pieces/<timestamp>.json`) — at this document's size (a few hundred KB even at full
     scale), keeping every snapshot ever taken for years costs a rounding error in storage, so
     there's no pruning logic to get wrong.
   - Both are best-effort: a backup failure is swallowed (`.catch(() => {})`), never allowed to
     fail the actual write it's shadowing.
2. **Daily reconciliation (self-healing safety net)** — `backup-worker/`, a small, separate, plain
   Cloudflare Worker (deliberately **not** folded into the main Astro app, even though Astro's
   Cloudflare adapter does support a custom entrypoint that adds a `scheduled()` handler alongside
   Astro's own — that's a newer, less-traveled integration path, and this is exactly the piece
   where "boring and hard to break" matters more than "one fewer thing to deploy"). Runs once a
   day (`triggers.crons` in `backup-worker/wrangler.jsonc`) with its own bindings to both buckets:
   reads the current metadata, checks every referenced image has a backup copy and copies any that
   don't (self-healing anything the on-write path ever missed), takes a redundant metadata
   snapshot, and writes a log entry (see below). Has no public route (`workers_dev: false`, no
   custom domain) since it only ever needs to run on its own schedule; its `fetch` handler exists
   solely so the same check can be manually re-run on demand (via `wrangler dev --remote` or the
   dashboard) for verification, without waiting for the next scheduled tick.

**Visibility — a log, not a single overwritten status**: the first pass wrote one `status.json`
that only ever reflected the *last* run — insufficient per explicit feedback ("I don't wanna have
to go to the backups, I'm gonna forget it exists... here's the last 7-10 backup jobs that were
run"). Instead, every backup-relevant event — each on-write backup from an edit, each daily
reconciliation run — writes its own small, individually-keyed, never-overwritten entry under
`backups/log/` (`BackupLogEntry` in `src/lib/backup.ts`). Reading "the most recent N" paginates
through the *entire* key listing rather than trusting R2's first-1000-objects-per-call, so it
stays correct once the total count eventually exceeds that (years out, at the rate this is used).
**`/admin` shows the last 10 of these directly, inline** — not a link to go check elsewhere, which
was the whole point of the feedback. `/admin/backups` still exists as the deeper view (last 50,
plus the full metadata snapshot list) since that was explicitly wanted kept too.

**What this doesn't cover**: an off-Cloudflare copy (protecting against, say, the whole Cloudflare
account being compromised or suspended, not just an app bug) — a strictly larger, different threat
model than "bugs in this code" than what was asked for. Worth considering later if wanted, not
built now.

## Images: R2 + on-demand resizing via the Images binding

Originals land in R2 (zero egress fees, ~$0.015/GB/mo). Serving them goes through
`src/pages/img/[...key].ts`, which does one of two things depending on the request:

- **No `?size=` query param** → the untouched original, byte-for-byte, exactly as uploaded. This is
  `originalImageUrl(r2Key)` in `src/lib/images.ts` — used sparingly, e.g. the "View full
  resolution" link on `/piece/<id>`, never for anything embedded directly on a page.
- **`?size=thumb|card|big`** → resized and re-encoded to WebP on the fly via the Cloudflare
  **Images binding** (`env.IMAGES` — not the older `/cdn-cgi/image/...` URL-rewriting mechanism
  originally planned; the Cloudflare adapter auto-provisions this binding, confirmed by inspecting
  the generated deploy config, even though it isn't declared in this project's own
  `wrangler.jsonc`). Falls back to serving the untransformed original on any transform failure
  (corrupt file, unsupported format, etc.) — best-effort, matching the pattern used elsewhere in
  this codebase for things that shouldn't be allowed to break the request they're shadowing.

**Sizes are a small fixed set of buckets, not one arbitrary width per container** —
`SIZE_WIDTHS` in `src/lib/images.ts`: `thumb` (240px, admin thumbnails / map hover popup), `card`
(1000px, the big gallery grid everywhere it appears, and the OG/Twitter card image), `big` (1800px,
`/piece/<id>`'s full view, the map's inline detail panel, the timeline gallery frame, and the one
`heroFirst` opening image specifically, since it renders much larger than an ordinary card).
`imageUrl(r2Key, size)` takes size as a **required** argument — no default — so every call site is
a conscious choice rather than silently inheriting whatever a default happened to be. A fixed
bucket set also keeps the number of distinct (source image, size) combinations bounded, which
matters because Cloudflare Images bills and Workers Cache caches each unique combination
separately — an arbitrary width per breakpoint would fragment across far more variants than
actually needed.

**This works in local dev, unlike the URL-rewriting approach** — confirmed directly (not assumed):
`wrangler dev`/`astro dev` support a "low-fidelity" mode of the Images binding covering exactly
`width`/`height`/`rotate`/`format`, which is all this needs. Verified locally against a real
request (content-type changed from `image/png` to `image/webp`, and the output's actual pixel
dimensions matched the requested bucket width) before ever deploying.

**Real-world confirmation against production** (a 5,011,202-byte / 5697×4007 iPhone photo):
`big` → 2,125,324 bytes (−58%), `card` → 745,980 bytes (−85%), `thumb` → 47,878 bytes (−99%). All
three fall back correctly to the untransformed original on an invalid/missing `size` value or a
transform error, and re-fetch a fresh R2 read for that fallback rather than risk returning a
partially-consumed stream if the transform attempt had already started reading it.

## Auth: Cloudflare Access + Google

A Cloudflare Access application (team domain `untitledtrading.cloudflareaccess.com`) guards
`klauria.art/admin*` — the wildcard is what makes it cover every admin subpath (`/admin/new`,
`/admin/edit/<id>`, `/admin/favorites`, `/admin/backups`), not just the literal `/admin` index.
Public read routes are outside this application entirely; they never see a login wall.

- **Identity provider**: Google OAuth (an OAuth client created in Google Cloud Console, wired into
  Cloudflare's Zero Trust → Authentication → Login methods).
- **Policy**: a single Allow policy, restricted to one specific email via the `Emails` include rule.
- **Mechanics**: unauthenticated request to a guarded path → `302` to Cloudflare's hosted login page
  → Google OAuth → Cloudflare checks the returned email against the policy → issues a short-lived
  signed session cookie (`CF_AppSession`) → then forwards the request to the Worker. This happens
  entirely at the edge, before the Worker ever runs — confirmed by observation (`curl` against an
  unauthenticated `/admin` request returns the `302`/`Set-Cookie` directly from
  `untitledtrading.cloudflareaccess.com`, never reaching Astro). The gate itself requires zero
  application auth code; it's pure edge configuration.
- **Defense-in-depth**: the Worker also reads `Cf-Access-Authenticated-User-Email` and compares it
  against an `ADMIN_EMAIL` Worker secret (`src/lib/adminGuard.ts`) before allowing any mutation —
  redundant with Access's own policy by design, in case the Access application is ever
  misconfigured or briefly disabled. This check no-ops (always allows) when `ADMIN_EMAIL` is unset,
  which is true for local dev, since Access itself doesn't exist there either.

## Map + inline detail (one of two JS islands)

Leaflet, custom pins from `data/pieces.json` (embedded inline as a `<script type="application/json">`
tag on the home page — no separate data fetch), styled/wired up in `src/scripts/mapPage.ts`. Opens
zoomed out on the whole world (`setView([20, 0], 2)`), not auto-fit to wherever the pieces happen to
be — deliberately reverted from an earlier auto-fit-to-bounds version, since the point of opening the
map is seeing the globe first, then zooming into a pin yourself. Hover a pin → small thumbnail popup.
Click a pin → renders full detail in a panel below the map, via a small hand-written JS function
reading the already-loaded piece data.

**Clustering**: `leaflet.markercluster` groups nearby pins into a numbered badge that splits apart as
you zoom in, recolored to the site's palette. This took three attempts, worth recording since the
first two seemed reasonable going in but solved the wrong problem:
1. Group by lat/lng rounded to ~11m. Failed in practice — two pieces considered "the same place"
   are often clicked at noticeably different spots on a zoomed-out map, easily outside 11m of each
   other, so grouping almost never fired.
2. Group by the piece's `placeName` string instead. Explicitly rejected — this only merges pieces
   with an identical place name, but what was actually wanted is **dynamic, zoom-dependent
   merging**: two pieces on opposite sides of a city should merge into one badge at world zoom (a
   few screen pixels apart) but split into individual pins once zoomed into that city (hundreds of
   pixels apart). No key computed once from the data, however chosen, can do that — it has to be
   recomputed live from the map's actual current pixel geometry every time the zoom changes.
3. `leaflet.markercluster` (a mature, decade-old, widely-used Leaflet plugin — the same "well-
   established, not a fad" bar Leaflet itself was picked under) does real pixel-distance
   clustering that recomputes on zoom/pan, and "spiderfies" (fans out into individually-clickable
   satellite markers) a cluster that still has multiple pieces once zoomed in as far as possible —
   which is what handles pieces at the literal same point, with no custom prev/next paging UI
   needed for that case. `mapPage.ts` went back to one marker per piece; the library owns all
   grouping/positioning.

**Another known bundler quirk — the default marker icon**: Leaflet's built-in marker icon resolves
its image path relative to its own CSS file at runtime, which breaks once bundled by Vite (shows up
as a broken-image box with cut-off alt text — "Mark..." — instead of a pin). Fixed by importing the
three marker PNGs with an explicit `?url` suffix (needed specifically because without it, Astro's
`astro:assets` pipeline intercepts the `.png` import into a `{src,width,height}` object instead of a
plain URL string) and calling `L.Icon.Default.mergeOptions({iconRetinaUrl, iconUrl, shadowUrl})`.
Both `mapPage.ts` (the public map) and `pieceForm.ts` (the admin location picker) run their own
independent Leaflet setup, so this fix had to be applied to each one separately — fixing it in one
file doesn't fix the other, which is exactly how it briefly recurred (fixed in `mapPage.ts` first,
found still broken in `pieceForm.ts` afterward).

**Known bundler quirk**: `import 'leaflet.markercluster/dist/MarkerCluster.css'` (the identical
pattern already working for `leaflet/dist/leaflet.css`) silently produces no CSS output — confirmed
this isn't a bad path by pointing the import at a deliberately nonexistent filename, which correctly
errored the build, proving the real path does resolve; the file's content just never reaches any
emitted chunk, even after a full cache-clear and rebuild. Worked around by inlining the plugin's
small, stable base CSS directly into `Base.astro`'s global stylesheet instead of importing it from
the package — acceptable since that CSS essentially never changes.

The piece-detail rendering logic exists in two places as a result of the inline panel — the map
island's vanilla-JS renderer, and the Astro component used for the real `/piece/<id>` permalink page.
That's the accepted cost of skipping htmx: one contained duplication, not a site-wide one. Every
piece still gets a real static permalink page (sharing, SEO/OG tags, JS-off access).

## Timeline (the other JS island)

A native `<input type="range">` scrubber, one step per month rather than per piece — dragging a
native slider is "the scrubbing," and per-month granularity means it's coarse/deliberate rather than
needing fine motor precision to land on one specific piece among hundreds. Oldest month on the left,
most recent on the right (opens on the most recent), matching how a timeline reads. Below it, a small
gallery frame shows the selected month's primary image, with `‹ Previous here` / `Next here ›`
buttons that appear only when a month has more than one piece, to page through them without touching
the slider — dragging picks "when," the arrows pick "which one." `src/scripts/timelineScrubber.ts`,
same `setupX()`-export-plus-embedded-JSON pattern as the map island.

**The track itself is the "what have I been up to" visual**: its background is a server-computed
`linear-gradient`, one hard-edged color band per month, blended between a gray-brown (dry media) and
blue (wet media) based on that month's actual mix — reusing `classifyMedium()`, the same dry/wet
split already used elsewhere, not a new finer-grained medium taxonomy. This replaced an earlier
static stacked-bar-per-month chart entirely, rather than keeping both, since the slider's track
conveys the same density information while also being the actual control.

## Tags

A tag cloud on the home page (below Timeline) — every distinct tag across all pieces, via the
existing `getTagFrequency()` (already built for the admin form's tag-suggestion chips), rendered as
`tag-chip` links sized on a simple linear scale between the least- and most-used tag, linking to
`/tag/<slug>`. No separate index page; this is the one place all tags are browsable from.

## Visual design: image-forward, minimal chrome

Redone 2026-07-22 after the initial build read as a generic site rather than a personal art archive
("SO SO SO MUCH SPACE... the priority is THE IMAGES"). Calibrated directly against a real painter's
site (juddmercer.art — its actual HTML/CSS was fetched and checked, not guessed from memory) for
scale and structure. Key decisions, several only found to be wrong after seeing them live and
correcting once:

- **No dark mode.** Removed the `@media (prefers-color-scheme: dark)` block entirely — never asked
  for, always the light/cream palette now.
- **A compact header, not a full nav bar.** A small site-title link plus a hamburger toggle — a
  plain checkbox/label pair (no JS at all) that reveals Home/My-easel-setup as a dropdown, instead
  of a bordered nav strip and a heavy underlined `<h1>` sitting above the fold on every page. The
  shared `h1` style is also much smaller/quieter site-wide as a result (other pages' own `<h1>`,
  e.g. a piece's title, still needs to read clearly, just without the old thick border-bottom).
  "Browse" and "Admin" were later removed from the dropdown too — Admin now sits inline with the
  render-id debug footer at the very bottom, styled to blend into that muted line, since "only I
  will ever click it."
- **`PieceList.astro`'s `large` variant** (used for every big-image section) went through several
  live-corrected iterations before landing:
  - No border around images anywhere (`img { border: ... }` removed globally) — direct feedback
    against juddmercer.art having none.
  - Full viewport width, breaking out of the page's own centered/padded container via the standard
    `left:50%; margin-left:-50vw` trick, but with a shared `--gutter` inset (currently `4vw`) on
    each side rather than running truly edge-to-edge.
  - **Real bug, not a preference**: that gutter was first `1rem` on the images but the page body
    still used a separate, fixed `1.5rem` padding for its text — two different values that only
    coincidentally matched at one specific viewport width. Fixed by hoisting a single `--gutter`
    CSS variable and having both `body`'s padding and the gallery's inset reference it.
  - **A second, larger version of the same bug**: `body`'s `max-width` was `64rem` (1024px) and
    centered — on any screen wider than that (i.e. most desktops), the auto-centered body sat
    inset from the real viewport edge by `(screen width − 1024px) / 2` *on top of* the gutter,
    while the full-bleed gallery images correctly stayed inset by only the gutter — a growing
    misalignment between text and image edges as screen width increased. Fixed by raising `body`'s
    `max-width` to `1920px`, matching juddmercer.art's own `maxPageWidth` (confirmed from its
    fetched CSS) — wide enough that the mismatch never triggers on a real screen.
  - Auto-fit grid at `minmax(min(480px, 100%), 1fr)` — one huge piece per row on mobile, naturally
    2-3 per row on a wide desktop window. The `min(480px, 100%)` matters specifically for mobile:
    a bare `480px` minimum is wider than most phone screens, which forced the grid (and the image
    in it) past the edge of the viewport, needing a horizontal scroll to see the rest of the image
    — a real, reported bug, not a style choice.
  - Natural (non-cropped) aspect ratio per image, not a forced square — the point is showing the
    whole piece.
  - A `heroFirst` prop forces only the very first piece of the page's *actual* opening gallery to
    span the full row as a big one-time opening beat (`grid-column: 1 / -1`) — originally this
    fired on every `.piece-grid.large` on the page unconditionally, which made every later batch's
    first image look randomly oversized rather than reading as deliberate.
- **Tall/portrait images rendering too big to see on screen**: `max-width:100%; height:auto` had no
  height cap at all, so a tall scan could render many multiples of the viewport's height at full
  container width. Fixed with `max-height:85vh` alongside (`width:auto; height:auto` on both axes),
  on `/piece/[id]` and the map's inline detail panel.
- **The home page itself** is one continuous scroll rather than separate sections stacked
  top-to-bottom: favorites/recent → Map → more recent → Timeline → a random pick → Tags → another
  random pick → the lifetime/year stat at the very bottom (moved there from a boxed callout near
  the top, since it's "a stat I wanna look at," not something a visitor needs first). Real art
  keeps appearing between the three "explore by X" tools rather than being front-loaded once,
  matching explicit feedback: "a user comes in and it's like they're surrounded by my images, and
  then there's ways for them to enter in and see more."

## Admin form conveniences

Small quality-of-life additions to the new/edit piece forms (`src/scripts/pieceForm.ts`), each
following the same rule: never clobber a value the owner already set on purpose.

- **Filename-derived title** (existing) and **filename-derived date** (added 2026-07-22): selecting
  the final image tries to parse a date out of its filename (`YYYY-MM-DD`/`YYYY_MM_DD`, or a bare
  `YYYYMMDD` run — the common phone-camera pattern, e.g. `IMG_20231114_153022.jpg`) and pre-fills
  the date field. Title suggestion only fills an empty field; date can't use that same check since
  the field is never genuinely empty (today's date, or the piece's real existing date) — instead
  the value at page load is tracked, and only overwritten while the field still holds exactly that.
- **Location search**: a text input + Search button next to the location map, forward-geocoding via
  the same Nominatim service already used for reverse geocoding (no new dependency). Takes the
  single best match rather than offering a list of candidates — not worth the extra UI for
  searching an obvious named place on a tool only one person uses. Reuses the existing
  `setLocation()` helper once a result comes back, so it's indistinguishable from a manual map
  click. The map itself is `60vh` tall (`min-height:420px`) — a fixed 280px strip read as "a thin
  horizontal rectangle, hard to work with."
- **Tag photos at upload time, not on a second trip** (2026-07-22): "additional photos" upload as
  one generic multi-file batch (`asset_extra`, one input, select as many as you want) instead of a
  separate labeled file field per kind (reference/in-progress/value-study/setup) — picking a kind
  per photo while still in the phone's Photos app meant reopening it once per kind. Selecting files
  fires `setupExtraAssetTagging()` (`pieceForm.ts`), which renders a thumbnail plus a kind
  `<select>` for every file immediately, right on the same form — tagging happens once, before ever
  hitting Save, not "afterward on the edit page" (an intermediate design, corrected same-day once
  it turned out that was still too many clicks). Each select is named `kind_extra_<i>`, indexed to
  the order files appear in the input's `FileList`, which is also the order the server sees them in
  via `formData.getAll('asset_extra')` — no need for a stable per-file id, since nothing reorders
  between selection and submit. The edit page additionally keeps a *separate* re-kind mechanism
  (`kind_<assetId>` selects) for assets from a previous submission — the two don't overlap.
  **A Cloudflare-workers-types quirk hit while building this**: `row.append(img, select)` failed
  `astro check` with an overload error mentioning `content: string | ReadableStream | Response` —
  `@cloudflare/workers-types` globally declares its own `Element` (from the `HTMLRewriter` API)
  that collides with DOM's `Element` and shadows `.append()`'s normal multi-node signature. Two
  `.appendChild()` calls sidestep it; worth remembering for any other DOM-building code in this
  codebase.
- **"Add another piece" shortcut**: `/admin/new`'s success redirect goes to `/piece/<id>?added=1`
  instead of a bare `/piece/<id>`; `/piece/[id].astro` checks for that exact query param and only
  then shows a `← Add another piece` link back to `/admin/new` above the title, since adding one
  piece is usually immediately followed by adding another. Nothing else ever links to a piece with
  `?added=1`, so this never appears for other viewers.

## Page inventory

- `/` — home: one long visual-forward scroll, not a set of separate tabs — big full-bleed images
  interspersed with the ways to explore the rest of the collection: the interactive Leaflet map
  (by location), the timeline scrubber (by time), and a tag cloud (by tag), each followed by more
  big images rather than all three tools stacked back to back. Revised 2026-07-22 per explicit
  owner feedback ("I want to give someone my website and they open it and BANG — fullscreen
  images... surrounded by my images"): `/map`, `/timeline`, and non-JS `/browse` used to be
  separate nav-linked pages; all three are gone as standalone routes — map and timeline folded
  directly into `/` (same underlying map/timeline islands described above, just rendered on the
  home page), and browse removed outright as "pointless, I'll never use it."
- `/piece/<id>` — full detail, static-feeling page (SSR + cached).
- `/tag/<slug>` — one template, covers medium tags, trip tags, and any other descriptive tag.
- `/kind/<kind>` — one template, covers every asset kind (`/kind/setup`, `/kind/value-study`, ...);
  same big image-forward `piece-grid large` treatment as the home page, not a small thumbnail list.
- `/admin` — upload form, edit-piece form, favorites reorder — plain HTML forms with
  full-page-reload submits. Favorites reordering starts as an editable numeric rank field per row.
- `/deploy-purge` — not a real page, a token-gated GET endpoint (see the Cache policy section) for
  purging the cache after a deploy from a CLI session that can't go through Cloudflare Access.

**"Phases"**: not a stored field. Derived automatically by classifying each piece's medium tags into
rough groups ("dry" — pencil, ink — vs "wet" — watercolor, gouache, oil, acrylic) and charting density
over `date` — see the Timeline section above for how this is actually surfaced (an interactive
scrubber colored by this classification, not a static chart).

## Open items (deliberately deferred)

- Exact validation rules for admin forms beyond what already exists (required fields, file-type
  checks).
- Whether to add explicit JWT-signature verification of the Access token server-side.
- Whether a future search box over notes/titles is wanted (likely just client-side substring search
  over the existing JSON document at this scale).
- Whether to keep `/deploy-purge` as standing infrastructure, given it exists to work around a real
  gap (deploys don't purge the cache on their own — see Cache policy) rather than being originally
  designed in.
- Removing the now-fully-dead `pinnedLinks` field/type, and the general codebase complexity audit
  the owner asked for — tracked in docs/TODO.md's standing simplicity-audit section, not done yet.
