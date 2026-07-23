# Architecture

A website cataloging years of on-location sketches/paintings (NYC, Providence, India trips, national
parks) for the artist, their family, and friends. The core tension it's designed around: the site must
be **static-fast** for every viewer (snap-open on a phone anywhere in the world, no spinner, minimal
JS) while still being **easy to edit** every few days (upload a new piece, retag things, reorder
favorites) **without a git-commit-and-redeploy step**.

**"Static-fast" is meant literally, not loosely**: the goal is the actual performance
characteristics of a static site — HTML pages and images sitting already-rendered in Cloudflare's
edge cache, served in single-digit milliseconds with the Worker never running at all — despite the
underlying content being dynamically editable. This is *why* the caching design gets this much
attention (see **Cache policy** below): a short TTL that just re-renders every few minutes would
give up this property in exchange for simplicity, which is explicitly not the trade wanted here.
The whole point of the purge-on-write architecture is getting both at once — a page can sit cached
for weeks, but the moment something actually changes, it's invalidated immediately, not "eventually,
within N minutes."

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
    { "id": "a1", "kind": "final", "r2Key": "assets/2023-india-jaipur-001/a1-v1.png",
      "sizes": { "thumb": "assets/2023-india-jaipur-001/a1-thumb-v1.webp", "card": "assets/2023-india-jaipur-001/a1-card-v1.webp", "big": "assets/2023-india-jaipur-001/a1-big-v1.webp" },
      "width": 0, "height": 0 },
    { "id": "a2", "kind": "reference-photo", "r2Key": "...", "sizes": { "thumb": "...", "card": "...", "big": "..." }, "width": 0, "height": 0 }
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
- `assets[].r2Key` / `sizes`: `r2Key` is always the **pristine original** (preservation master, only
  served by "View full resolution", and the only thing backed up). `sizes` holds the three
  pre-generated WebP variant keys (`thumb`/`card`/`big`) the site actually embeds — **required, never
  optional, no master fallback**: every asset always has all three (enforced by the type, the upload
  path, and the backfill), so a missing variant is a bug to fix, not a state to tolerate. `imageUrl(asset,
  size)` resolves it. See the **Images** section for how variants are generated (at upload, in the browser).

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

Every actual page response (never `/admin/*`, never `/img/*` — see **Purging by tag, not
everything** below) carries the same two headers, set together by `setPageCacheHeaders()`
(`src/lib/cache.ts`):

```
Cache-Control: public, max-age=60, s-maxage=2592000
Cache-Tag: page
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
  code reruns. It's long *on purpose* — the whole point is that a page, once rendered, sits cached
  at the edge for weeks, genuinely static-site-fast, not re-rendering on some short clock. *Purge*,
  not expiry, is what keeps it correct instead: step 6 of the write flow invalidates it the instant
  something changes, and a missed/failed purge is self-healing (the next edit purges everything
  again regardless of what it touched). **Correction**: an earlier version of this doc claimed the
  Worker's deployed version is automatically part of the cache key, so a fresh deploy alone would
  start with an empty cache with no purge needed. That turned out to be false — see the
  `/deploy-purge` gap below, found precisely because a deploy did *not* invalidate a stale cached
  page on its own. Workers Cache keys purely on the request URL; it has no idea a new Worker
  version exists.
- **`max-age` (the visitor's own browser, 1 minute)**: a server-side purge has zero effect on a
  browser's already-cached local copy — there's no way to remotely invalidate that. Kept short
  (rather than, say, an hour) mainly so the site owner can debug the live site without constantly
  clearing their own browser cache; a re-ask this frequent is cheap regardless, since it's just
  browser-to-edge traffic and the edge already has the fresh, purged-and-rerendered response cached
  and ready — this value has no bearing on how often Astro's render code actually runs.

**Considered and rejected: a short TTL instead of purge-on-write.** Raised directly (2026-07-23,
prompted by the awkwardness of managing the `/deploy-purge` token across sessions — see below):
just drop purge-on-write and `/deploy-purge` entirely, shorten `s-maxage` to a few minutes, and let
everything — data edits and code deploys alike — roll out on its own within that window. Rejected:
that gives up the actual goal stated at the top of this document. A multi-minute TTL means the site
goes back to re-rendering on a schedule rather than sitting genuinely cached — "no longer a site
with the performance characteristics of a static site, where the HTML and images are all cached and
ready to go, sitting in Cloudflare's edge cache." That property, not merely "eventually consistent
within N minutes," is the actual design target, and it's *why* this section gets this much
scrutiny in the first place — a short TTL would be simpler, but it trades away the one thing this
whole cache design exists to protect. Long `s-maxage` plus purge-on-write is the only way found so
far to get both genuinely-static edge performance *and* changes appearing immediately.

Purging calls `cache.purge()` (imported from `'cloudflare:workers'`) **from inside the Worker** —
this needs no API token or zone ID at all, unlike the zone-level Cache Purge HTTP API. That's
actually the important part of the correction: per Cloudflare's own docs, "no zone-level purge (via
the dashboard, API, or Terraform) affects Workers Caching content" — only this in-Worker call does.
The zone HTTP API this app used to call had no effect on Workers Cache whatsoever, meaning the
original purge-on-write design was silently a no-op even before the missing-Cache-Rule issue was
found.

**Purging by tag, not everything.** `cache.purge()`'s `CachePurgeOptions` support `tags` and
`pathPrefixes` alongside `purgeEverything` — `purgePages()` (`src/lib/purge.ts`, called from every
admin write handler and from `/deploy-purge`'s default path) uses `{ tags: ['page'] }`, matching the
`Cache-Tag: page` header every actual page sets. This was a real correction (2026-07-23): the
original design used `purgeEverything: true` for every purge, which — since `/img/...?size=...`
responses are served by this same Worker through this same cache — also nuked the resized-image
cache on every single admin edit, even though an edit to a piece's title/tags can never change what
an image looks like. That forced Cloudflare Images to redo resize work that had nothing to do with
whatever triggered the purge, on every write. `pathPrefixes` was considered and rejected as the
mechanism instead of tags — it would mean enumerating every non-`/img/` route prefix to purge,
reintroducing exactly the "list of affected paths to maintain, easy to forget one" problem this
whole purge-on-write design exists to avoid. Tags don't have that drift risk, as long as every page
route keeps using the shared `setPageCacheHeaders()` helper rather than setting `Cache-Control`
directly. `purgeEverything()` still exists as a rarely-used escape hatch (`/deploy-purge?...&full=1`
/ `node scripts/deploy-purge.mjs --full`) for the rare case a real hard reset is needed — e.g. this
migration itself needed exactly one full purge to flush cache entries from before the tag existed.

**A quirk worth knowing**: a client fetching an already-cached page does not see the `Cache-Tag`
header back in the response — Cloudflare consumes it internally for purge-matching without
necessarily echoing it out on a served `HIT`. This looked like the tagging wasn't working at first;
confirmed it actually was by checking the effect instead of the header — purging by tag reliably
changed the home page's debug render-id (see below).

**How confident is "images are untouched," precisely.** The *structural* guarantee is airtight and
doesn't depend on live testing at all: `/img/*` responses never carry `Cache-Tag`, and a tag-scoped
`cache.purge()` call can only match entries that carry the tag being purged — it is mechanically
unable to touch something it was never told to tag. Live re-testing this in production (pressed
directly on "have you actually tested this") was messier than a first pass suggested: baselining a
`card`-size image at a stable `HIT` (age ~52 min, clearly pre-existing), firing a tag purge, then
immediately re-checking that same image came back a single `MISS` — the opposite of expected.
Rather than explain that away, it was investigated: 5 rapid rechecks afterward were all `HIT`
again, and the `age` on that `HIT` was 47 seconds — *older* than the whole purge-to-recheck test
window, meaning it couldn't have been a freshly-regenerated copy from that purge. Conclusion: the
single `MISS` reads as ordinary per-edge-colo cache routing variance (Cloudflare's cache is spread
across many PoPs; one request landing on a colo not yet synced with the shared upper tier is normal
and unrelated to purging), not evidence the tag purge reached an untagged image. A fully airtight
byte-level check (comparing `ETag` before/after) wasn't possible to run: `src/pages/img/[...key].ts`'s
resize path never sets an `ETag` at all — only the untransformed-original/fallback path
(`passthrough()`) does. Worth adding if tighter verification is ever wanted; not done as part of
this change. Bottom line: verified with high confidence via the structural guarantee, not "zero
ambiguity ever observed live."

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

**A real gap found after this design was already live**: `purgePages()` (originally
`purgeEverything()`) only ever runs from inside an authenticated admin write handler — a pure code
deploy with no accompanying data edit never purges anything. Caught live when a route removed in a
deploy kept serving its old, now-nonexistent page from a still-warm cache entry, well past when
that deploy went out. Since deploying happens from a CLI session with no Cloudflare Access login,
the existing purge-on-write path can't be reused directly — `src/pages/deploy-purge.ts` is a small
GET endpoint gated by a `DEPLOY_PURGE_TOKEN` Worker secret instead (404s on any mismatch or if the
secret isn't set, so its existence isn't advertised), purging pages by tag by default, with an
optional `?full=1` for the full-purge escape hatch. **Purge propagation is also not instant in
practice** — repeatedly confirmed a stale `HIT` for 15-30+ seconds after calling it, before a
re-check finally showed a fresh `MISS`. Don't trust the first post-purge check; wait ~25-30s and
re-verify.

## Deploying

`npm run deploy` is the one command — `predeploy` (an npm pre-script hook that fires automatically)
runs `astro check && vitest run && astro build`, then `wrangler deploy`, then
`scripts/deploy-purge.mjs`. This replaced a manual multi-step sequence (check, test, build, deploy,
locate the purge token, curl `/deploy-purge`, wait, re-verify) after explicit feedback that a
several-step manual dance for something this routine was exactly the kind of complexity to avoid.

**`DEPLOY_PURGE_TOKEN` is never persisted anywhere, on purpose.** It's a Worker secret with no
natural session-independent home — not in the repo (it's a real secret), and a scratchpad copy only
lasts one Claude session. Rather than solve that storage problem, `scripts/deploy-purge.mjs` avoids
needing one: it generates a fresh random token, sets it as the secret via `wrangler secret put`
(piped through stdin, non-interactive — using the `wrangler` login already authenticated in the
environment), uses it immediately to call `/deploy-purge`, and then it's gone. Nothing to remember,
nothing that can go stale, and rotating it every deploy is arguably *more* secure than a long-lived
token would be, not less. The purge call retries up to 8 times, 5 seconds apart — a secret rotation
is itself a small deploy and can take a few seconds to fully propagate before the new token is
recognized everywhere; the first live run of this failed with a tighter 5×4s budget, which is why it
was loosened.

**Explicitly considered and rejected: dropping this in favor of a short cache TTL.** See "Considered
and rejected: a short TTL instead of purge-on-write" above — that would have sidestepped the token
problem by removing the thing that needs it, but at the cost of the site's actual genuinely-static
edge-cache performance goal. Automating the existing multi-step process was the fix, not
simplifying away the design it was automating.

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

## Images: pre-generated variants on R2, no on-the-fly resizing

Every image is stored on R2 as plain, immutable, versioned objects — **a preservation master plus
three pre-generated WebP variants** (`thumb`/`card`/`big`). There is **no on-the-fly resizing**:
`src/pages/img/[...key].ts` is a dumb passthrough that streams whatever key it's given
(`writeHttpMetadata` + `etag` + `Cache-Control: public, max-age=31536000, immutable`). Nothing to
transform, nothing to fail.

- `asset.r2Key` = the pristine master, exactly as uploaded (`originalImageUrl()` / the "View full
  resolution" link on `/piece/<id>`; never embedded on a page). It's the archive copy and the only
  thing the backup bucket keeps — variants are regenerable derivatives, not backed up.
- `asset.sizes = { thumb, card, big }` = the variant keys. **Required, not optional, no master
  fallback** (see the piece-record shape section) — every asset always has all three, so a missing
  one is a bug that fails loudly rather than silently serving the multi-MB master. `imageUrl(asset,
  size)` (`src/lib/images.ts`) just returns `/img/${asset.sizes[size]}`.
- `SIZE_WIDTHS` (`src/lib/images.ts`): `thumb` 240px (admin thumbnails / map hover popup), `card`
  1000px (every gallery grid, the OG/Twitter image, the timeline gallery frame), `big` 1800px
  (`/piece/<id>`'s full view, the map's inline detail panel, the `heroFirst` opening image). Widths
  are shared by the client generator and the backfill so both produce identical buckets. Each variant
  is a WebP at quality 82 — for a 22MB PNG scan that's `card` ~105KB, `big` ~330KB, `thumb` ~9KB.

**Why this replaced the Cloudflare Images binding.** The site used `env.IMAGES` to resize on demand.
It brought a cluster of pain for a site that only ever needs three fixed sizes for one editor: a hard
**20MB `.input()` limit** that failed *silently* (the fallback served the full 20–32MB original for
every size — found live as a `?size=card` returning 20MB of `image/png`); a **high default WebP
quality with no control** (a 1800px `big` came out 2.6MB — larger than the source it was made from,
because the encoder over-spends bits and preserves the previous generation's artifacts); on-demand
transform + error-fallback machinery; and, for oversized images, a double lossy re-encode. Removing
the binding deletes all of that. (An earlier intermediate fix — a `displayKey` "access copy" for
just the >20MB images — was itself a workaround for the 20MB limit and is fully superseded by this.)

**Generation happens at upload, in the browser.** The Worker can't resize a 20–30MB scan (Workers
memory + no image lib we want to ship there), so `src/scripts/pieceForm.ts`'s `makeVariants()`
generates the three WebPs client-side when an image is selected — `createImageBitmap` (an
ImageBitmap *source*, not a full-size canvas, which sidesteps Safari's canvas-area limit on large
scans) drawn into a small target canvas, then `canvas.toBlob('image/webp', 0.82)`. They're loaded
into hidden `asset_<final|extra>_<size>[_i]` file inputs via `DataTransfer` (keeping the normal
multipart submit), and **Save is disabled (ref-counted) until every variant is ready**. The server
(`admin/new.astro` + `admin/edit/[id].astro`, shared `uploadAsset`, via `getVariantFiles()`) refuses
to create an asset unless all three variant files are present — so a variant-less record is never
written (covers JS-off / a failed generation with a clear form error, not a silent bad record).

`makeVariants()` is deliberately isolated behind that one function so the resize/encode engine is
swappable. It currently uses `<canvas>` (zero dependency, works on every browser, no WASM to load).
A sharper upgrade — **wasm-vips** (libvips-in-WASM, same engine `sharp` uses; verified in Node here
producing `card` 114KB / `big` 350KB) or **Pica** (Lanczos) — is a change confined to that function.
Canvas was chosen for the initial rollout specifically because it can't be browser-verified in this
environment (no browser automation available), and a WASM bundling/runtime failure would break every
upload; canvas can't. Worth revisiting once wasm-vips can be tested on a real (esp. iOS 16.4+) device.

**EXIF orientation — must be applied in every generation path.** Phone photos are frequently stored
landscape with an EXIF orientation tag (e.g. 6 = rotate 90°); the pixels are sideways until the tag
is applied. The old Cloudflare binding did this automatically — the pre-generated pipeline must do it
explicitly, or variants come out rotated wrong. Both paths handle it: the client uses
`createImageBitmap(file, { imageOrientation: 'from-image' })`, and `sharp` needs a bare `.rotate()`
(no args) before resize. This was caught live after the first backfill omitted it (a whole piece's
photos sideways), fixed by `scripts/reorient-image-variants.mjs` (regenerate with `.rotate()` only
the JPEG masters whose EXIF orientation ≠ 1 — PNG scans have none). **Gotcha within that fix:** sharp
caches `metadata()` by filename, so reading orientation from a reused temp path returns the *first*
file's value for every asset — read metadata from a `Buffer` (and/or `sharp.cache(false)`). Note the
resize/decode pipeline is *not* affected by this cache, so the backfill's variant *content* was
always correct — only the orientation *check* was fooled.

**Backfill.** Images uploaded before this change had only a master. `scripts/backfill-image-variants.mjs`
(Node + `sharp`, i.e. libvips — matches the intended client engine) generated all three variants for
every existing asset against production R2 via `wrangler --remote`: snapshots `pieces.json` first,
skips assets already done, writes progress after each piece (resumable), and exits non-zero if any
asset still lacks variants (since the required-`sizes` invariant means the new code must not deploy
until coverage is 100%). Run **before** deploying the new code — the old deployed code ignores
`sizes`, so there's no broken window.

## Auth: Cloudflare Access + Google

A Cloudflare Access application (team domain `untitledtrading.cloudflareaccess.com`) guards
`klauria.art/admin*` — the wildcard is what makes it cover every admin subpath (`/admin/new`,
`/admin/edit/<id>`, `/admin/favorites`, `/admin/bulk-tag`, `/admin/backups`), not just the literal
`/admin` index.
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

An **activity bar chart**, one bar per month across the whole span the collection covers — bar
height is how many pieces were made that month, and each bar is stacked by medium
(gouache/watercolor/sketchbook page) so it reads *how much* and *what kind* of work at a glance. This replaced an earlier `<input
type="range">` scrubber whose only "meaning" was a colored gradient track: the slider never labeled
the month or year and the gradient bands were too subtle to read as data, so it hid the data instead
of showing it (owner feedback: "it doesn't say the month or year, it just doesn't seem to mean
anything"). The bar chart makes the data itself the visual — the same "what have I been up to" the
scrubber's track was trying to convey, but legibly and clickable.

- **Empty months are kept as gaps** (a disabled, empty baseline bar), not skipped — so quiet
  stretches actually show up rather than the axis silently compressing time. `monthsBetween()` in
  `index.astro` enumerates every `YYYY-MM` from the first piece's month to the last, inclusive.
- **Bars are `<button>`s**; clicking one selects that month and shows its pieces in the gallery frame
  below (the same `‹`/`›` prev/next frame the scrubber used, unchanged — it appears when a month has
  more than one piece). Opens on the most recent non-empty month. Empty months are `disabled`, so
  they're not focusable or clickable and the JS ignores them (`:not(:disabled)`).
- **Buckets** (`timelineMedium()` in `index.astro`): by medium tag, priority **gouache > sketchbook
  page > watercolor** — a piece tagged both gouache and watercolor counts as gouache; both
  sketchbook-page and watercolor counts as sketchbook page; watercolor only if it has neither of the
  other two. `other` is a neutral catch-all (empty today — every piece has one of the three — but
  keeps the bar total honest if a piece with none is added later). Colors are a validated categorical
  palette (wine `#b23a5a` = gouache, blue `#2f6fd0` = watercolor, sepia `#b5732e` = sketchbook page,
  neutral gray = other), checked with the dataviz skill's palette checker; the site is light-only, so
  only light mode was validated.
- The chart is server-rendered CSS (a flex row of bars, each a flex column of segment `<span>`s with
  server-computed pixel heights) — no drawing library, no canvas. `src/scripts/timelineChart.ts`
  (`setupTimelineChart()`) only handles selection/paging, same `setupX()`-export-plus-embedded-JSON
  pattern as the map island; the per-month piece data is embedded as a `<script
  type="application/json">` tag keyed by month.

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
  container width. Fixed with `max-height:85vh` alongside (`width:auto; height:auto` on both axes)
  on `/piece/[id]` and the map's inline detail panel first — then found, live, still missing from
  `.piece-grid.large img` itself (`Base.astro`), the shared class every big-image section on the
  home page and `/kind/[kind]` actually renders through. A portrait image alone in a single-image
  row could stretch to the full-bleed row's width on a wide desktop, and at that width a tall
  aspect ratio still blew well past the viewport height — same bug, different (and more widely
  used) piece of CSS. Same fix applied there too, plus `margin:0 auto` to center the now-narrower
  image within its grid column instead of leaving it flush left.
- **The home page itself** is one continuous scroll rather than separate sections stacked
  top-to-bottom: favorites/recent → Map → more recent → Timeline → a random pick → Tags → another
  random pick → the lifetime/year stat at the very bottom (moved there from a boxed callout near
  the top, since it's "a stat I wanna look at," not something a visitor needs first). Real art
  keeps appearing between the three "explore by X" tools rather than being front-loaded once,
  matching explicit feedback: "a user comes in and it's like they're surrounded by my images, and
  then there's ways for them to enter in and see more."
- **Each gallery batch gets a small, quiet label** ("My favorite pieces I've made" / "Some recent
  pieces" / "Some random pieces") — `.section-label`, the same muted mono/uppercase voice as
  `.piece-grid .caption`, deliberately not a heavy `<h2>` like Map/Timeline/Tags get, since these
  batches are still just "more art," not another explore-by-X tool. Every batch of each kind gets
  its own label (both `recentA`/`recentB`, both `rediscoverA`/`rediscoverB`), not just the first —
  they're spaced apart by Map/Timeline/Tags rather than sitting adjacent, so a viewer scrolling past
  the second "recent" batch later on the page has nothing else tying it back to the first.

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
  click. The map itself grew twice from a fixed 280px strip ("a thin horizontal rectangle, hard to
  work with") — first to `60vh`/420px min-height, then to `70vh`/480px ("just a lil bit bigger").
- **Map click no longer jerks the view around**: `setLocation()` used to call
  `map.setView([lat,lng], 13)` unconditionally on every call, including a direct map click — so
  clicking a spot while already zoomed in past level 13 snapped the view back *out* to 13 right
  after placing the pin, and you had to zoom back in just to confirm it landed correctly. Now takes
  a `moveView` parameter (default `true`, used by search/geolocation, since those jump to a location
  that usually isn't visible yet) that the map's own `click` handler passes as `false` — a clicked
  point is already on screen, so only the marker needs to move, not the whole view. Where the view
  does move, zoom is `Math.max(map.getZoom(), 13)` instead of a flat `13`, so it can zoom in but
  never back out below wherever you already were.
- **Tag chips show selection state, and the tags box got bigger**: the tags field is a
  `<textarea rows="3">` now, not a single-line `<input>` — clicking several chips used to overflow
  a one-line box with no way to see what was already in there short of scrolling it horizontally.
  Chips also now toggle (click again to remove) and stay highlighted (`.tag-chip.selected`) in sync
  with the box's actual contents — including tags typed by hand, via an `input` listener, not just
  ones added by clicking. `setupTagChips()` (`pieceForm.ts`) is exported standalone specifically so
  `/admin/bulk-tag` (below) can reuse the same chip behavior without pulling in the rest of
  `setupPieceForm` (location map, file inputs) that page doesn't need.
- **`/admin/bulk-tag`**: apply or remove a tag across many pieces in one request, for retroactively
  tagging something across the existing collection (e.g. inventing "painted from life" after the
  fact) without a per-piece edit-page visit each time. Same list layout as `/admin/favorites`
  (thumbnail + title + date, one row per piece, no pagination at this collection's size) but with a
  checkbox instead of a rank field, plus a "Select all" toggle. One `<form>`, two submit buttons
  (`intent=add` / `intent=remove`) sharing the same checkbox selection — mirrors the
  `intent=delete` pattern already used by the edit page's delete-piece form. Add unions the given
  tag(s) into each selected piece's tags via a `Set` (so re-adding an already-present tag is a
  no-op); remove filters them back out.
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
- **The same `?added=1` view also visibly renders every asset's `thumb`/`card` size**, right under
  each image, not just the `big` size the page shows normally. Two reasons this exists: those two
  sizes are otherwise only ever requested from `/admin` (`thumb`) or a grid page (`card`) — a
  brand-new upload could sit un-cached for a while otherwise, even though a resized image is cached
  effectively forever once served (`Cache-Control: public, max-age=31536000, immutable`, and the
  edge cache is tiered, so one request warms it everywhere). More importantly, it surfaces a broken
  resize (see the Images section's "error-status Images response" bug) immediately, as a visibly
  broken image right where you land after uploading, rather than something only discoverable later
  by clicking a tag or browsing a grid. Deliberately rendered, not hidden/prefetched — the point was
  to *see* it, not just warm the cache silently.

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
- `/admin` — upload form, edit-piece form, favorites reorder, bulk tagging — plain HTML forms with
  full-page-reload submits. Favorites reordering starts as an editable numeric rank field per row.
- `/deploy-purge` — not a real page, a token-gated GET endpoint (see the Cache policy section) for
  purging the cache after a deploy from a CLI session that can't go through Cloudflare Access.

**"Phases"**: not a stored field. Derived automatically from each piece's medium tags
(gouache / watercolor / sketchbook page — see the Timeline section's bucket rules) and charted by
density over `date` — surfaced as the interactive activity bar chart, stacked by that classification.

## Open items (deliberately deferred)

- Exact validation rules for admin forms beyond what already exists (required fields, file-type
  checks).
- Whether to add explicit JWT-signature verification of the Access token server-side.
- Whether a future search box over notes/titles is wanted (likely just client-side substring search
  over the existing JSON document at this scale).
- ~~Open, unresolved: how should `DEPLOY_PURGE_TOKEN` actually be managed across sessions?~~
  **Resolved (2026-07-23)**: see the Deploying section above — `npm run deploy` regenerates it
  fresh every time via `scripts/deploy-purge.mjs`, so it never needs to persist anywhere.
- Removing the now-fully-dead `pinnedLinks` field/type, and the general codebase complexity audit
  the owner asked for — tracked in docs/TODO.md's standing simplicity-audit section, not done yet.
