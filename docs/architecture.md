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
  TTL expiry either — every admin write purges Cloudflare's entire edge cache for the zone. See
  **Cache policy** below for why that's better than either alternative.
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

Non-interactive pages are plain Astro components — zero JS shipped to the browser by default. The map
is the one **island** that hydrates and ships its own JS (Leaflet) plus the hand-written
click-to-detail script.

**Request walkthrough** (e.g. a viewer opening `/piece/042`):
1. Cloudflare's anycast network routes to the nearest edge PoP.
2. Cache hit (the common case — see **Cache policy** below): served straight from cache, sub-10ms,
   Worker never runs at all.
3. Cache miss (right after a purge, or the first-ever visitor from this region): Worker runs at
   that same nearby PoP, Astro renders the page from the current data in R2, response goes out with
   `Cache-Control`, and gets cached at that PoP.
4. First view of any given page/image from a brand-new region pays one real round trip to origin;
   Cloudflare's Tiered Cache reduces this further. Every subsequent view in that region is
   edge-cached until the next purge.

## Metadata storage: one JSON document in R2

A single object, `data/pieces.json`, holding:

```json
{
  "pieces": [ { "...piece record...": true } ],
  "pinnedLinks": [
    { "label": "Easel Setup", "href": "/kind/setup" },
    { "label": "India 2023", "href": "/tag/india-2023" }
  ]
}
```

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
- `assets[].kind`: `final | reference-photo | in-progress | value-study | setup` — extend freely; a
  new kind is just a new string value, never a schema migration.

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
6. Calls Cloudflare's Cache Purge API with `purge_everything: true` for the zone. No list of
   "affected pages" to compute — a full purge is indiscriminate by design, which is what makes it
   bug-free: there's nothing to forget.

## Cache policy: purge-on-write, not TTL-driven expiry

Every HTML page and the shared `data/pieces.json` fetch carries the same `Cache-Control`:

```
Cache-Control: public, max-age=60, s-maxage=2592000
```

Two independent caches read this header, for different purposes:

- **`s-maxage` (Cloudflare's edge, 30 days)**: this is what actually governs how often Astro's
  render code reruns. It's long because *purge*, not expiry, is what keeps the edge fresh — step 6
  of the write flow invalidates it the instant something changes. A missed/failed purge is
  self-healing: the next edit purges everything again regardless of what it touched. In steady
  state, Astro only reruns for two reasons: the request immediately after a purge (guaranteed
  miss), or the first-ever visitor from a new edge region.
- **`max-age` (the visitor's own browser, 1 minute)**: a server-side purge has zero effect on a
  browser's already-cached local copy — there's no way to remotely invalidate that. Kept short
  (rather than, say, an hour) mainly so the site owner can debug the live site without constantly
  clearing their own browser cache; a re-ask this frequent is cheap regardless, since it's just
  browser-to-edge traffic and the edge already has the fresh, purged-and-rerendered response cached
  and ready — this value has no bearing on how often Astro's render code actually runs.

Purging requires a Cloudflare API token (scoped to Cache Purge for this zone) and the zone ID,
stored as Worker secrets — set up once, alongside the R2 bucket and Access application, when the
site gets deployed to its own (sub)domain. Purge Everything is available on all Cloudflare plans
including Free, rate-limited to 5 requests/minute (far above what occasional edits need), and
propagates in well under a second. Images are unaffected by any of this — they stay long-cached/
immutable, since they're already invalidation-free by virtue of versioned keys.

**Important, easy to miss**: Cloudflare does **not** cache HTML at the edge by default, regardless
of the `Cache-Control` header — its default cache eligibility is decided by file extension
(`.css`/`.js`/`.png`/etc. are cached automatically; extensionless paths like `/piece/042` are not),
not by header presence. Without an explicit **Cache Rule** for this zone (`Eligible for cache: Yes`,
`Edge TTL: respect origin headers`), every request would silently hit the Worker and re-render —
the entire "renders once, then pure cache" premise depends on this one dashboard step. It's a
**required** part of the Cloudflare setup, not optional polish — see docs/TODO.md.

**Verifying it's actually working**: the precise signal is the `CF-Cache-Status` response header
Cloudflare adds to every response (`HIT` = served from cache, Worker didn't run; `MISS`/`EXPIRED`
= it did) — check via `curl -I` or the browser's Network tab. For an always-visible, no-devtools-
needed sanity check, every page also renders a small debug footer (see Base.astro) showing the
render timestamp and edge colo — if reloading the same URL keeps showing the same timestamp,
that request was served from cache, not re-rendered.

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

## Images: R2 + on-demand transforms

Originals land in R2 (zero egress fees, ~$0.015/GB/mo). Thumbnail/medium sizes are not separately
generated/stored files — they're the same R2 object requested through a Cloudflare Image
Transformation URL (`/cdn-cgi/image/width=...,format=auto/...`), resized and re-encoded (auto
AVIF/WebP) on first request per size, then cached at the edge. Because original keys are versioned,
transformed variants can be cached effectively forever.

## Auth: Cloudflare Access + Google

A Cloudflare Access application guards `/admin/*` and every mutating API route (`/admin/api/*`).
Public read routes are outside this application entirely.

- **Identity provider**: Google OAuth, configured in Cloudflare's Zero Trust dashboard.
- **Policy**: allow only the owner's email.
- **Mechanics**: unauthenticated request to a guarded path → Cloudflare's hosted login page → Google
  OAuth → Cloudflare checks the returned email against the policy → issues a short-lived signed
  session cookie → then forwards the request to the Worker. The Worker can optionally read
  `Cf-Access-Authenticated-User-Email` as a defense-in-depth check, but the gate itself requires zero
  application auth code — it's edge configuration.

## Map + inline detail (the one JS island)

Leaflet, custom pins from `data/pieces.json` (id, lat/lng, thumbnail, a couple of tags for pin
styling). Clustered when zoomed out. Hover → small thumbnail popup. Click → renders full detail in a
panel on the same page, via a small hand-written JS function reading the already-loaded piece data.

The piece-detail rendering logic exists in two places as a result — the map island's vanilla-JS
renderer, and the Astro component used for the real `/piece/<id>` permalink page. That's the accepted
cost of skipping htmx: one contained duplication, not a site-wide one. Every piece still gets a real
static permalink page (sharing, SEO/OG tags, JS-off access), and a plain non-JS "browse by location"
list page exists as a fallback path.

## Page inventory

- `/` — home: favorites first, then recent pieces, pinned quick-links, phase indicator.
- `/piece/<id>` — full detail, static-feeling page (SSR + cached).
- `/tag/<slug>` — one template, covers medium tags, trip tags, and any other descriptive tag.
- `/kind/<kind>` — one template, covers every asset kind (`/kind/setup`, `/kind/value-study`, ...).
- `/map` — the interactive Leaflet island.
- `/timeline` — chronological browse, all pieces.
- non-JS `/browse` — plain list grouped by place name, fallback for JS-off/crawlers.
- `/admin` — upload form, edit-piece form, favorites reorder — plain HTML forms with
  full-page-reload submits. Favorites reordering starts as an editable numeric rank field per row.

**"Phases"**: not a stored field. Derived automatically by classifying each piece's medium tags into
rough groups ("dry" — pencil, ink — vs "wet" — watercolor, gouache, oil, acrylic) and charting density
over `date`.

## Open items (deliberately deferred)

- Visual design: palette (pastels, purple/pink/red), typography, overall aesthetic.
- Exact validation rules for admin forms.
- Whether to add explicit JWT-signature verification of the Access token server-side.
- Whether a future search box over notes/titles is wanted (likely just client-side substring search
  over the existing JSON document at this scale).
