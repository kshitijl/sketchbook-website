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
- **Hand-write bespoke interactions; use the library for standard widgets.** These are the same
  rule, not opposing ones — the goal is least total complexity, not fewest dependencies. The map's
  inline detail panel is bespoke, so it's hand-written. Map clustering and favorites drag-reorder
  are solved, standard controls, so they're `leaflet.markercluster` and `sortablejs`. Both were
  hand-rolled first and both took three failed attempts before switching; see the Map section and
  **Admin form conveniences** for the post-mortems. Three attempts is the signal to stop and reach
  for the library, not to try a fourth.
- **Auth**: Cloudflare Access, Google as the identity provider, policy locked to the owner's email.
- **Data model**: assets (photos/scans) attach to a piece and are tagged by kind, including
  setup/environment photos (not a separate top-level entity). Every piece requires at least an
  approximate location. Trips, medium, and classifications like "painting" vs. sketchbook page are
  all just tags (open, multi-valued, no special fields) — there used to be a dedicated `stage`
  field for finished-vs-study, but it turned out never to be used in practice, so it was removed
  rather than kept as unused structure. No draft/private state — uploading makes something
  immediately live.
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
  "pieces": [ { "...piece record...": true } ]
}
```

**`pinnedLinks` was removed from the type on 2026-07-30.** It was an admin-editable quick-links
list that never got an admin UI to write it, and after the 2026-07-22 home page redesign nothing
read it either (the one thing it was ever meant to hold, an "Easel Setup" link, is hardcoded in
the header nav — building an editable-links feature for two or three fixed destinations was never
worth it). **No data migration was needed or done**: `data.ts` casts the parsed JSON and
re-stringifies whatever object it read, so documents already in R2 keep their now-undeclared
`pinnedLinks` key and it survives every subsequent write untouched. Verified by writing through
the admin UI after the removal and reading the stored blob back — top-level keys were still
`['pieces', 'pinnedLinks']`. It's inert either way; there's nothing to clean up unless you want to.

At ~1,000 pieces with generous fields, this is roughly 1-2MB uncompressed / a few hundred KB gzipped —
cheap to read, cheap to write, cheap to ship to the browser whole for the map/timeline islands.

**Piece record shape:**

```json
{
  "id": "2023-india-jaipur-001",
  "title": "Hawa Mahal, morning light",
  "date": "2023-11-14",
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

The footer also reports **which build is serving the page**: `deployed <timestamp> (<commit>)`,
added 2026-07-30. These are baked in at build time by Vite's `define` (see `astro.config.mjs`) —
the Worker has no git and no build clock at runtime, so build time is the only point either is
knowable, and since `npm run deploy` builds and deploys in one shot, a deployed page's build time
*is* its deploy time. The commit comes from `git describe --always --dirty`, so a build made with
uncommitted changes is labelled `<hash>-dirty` rather than silently claiming to be that commit.
This exists to separate two failure modes that look identical from the outside: a page that looks
stale because it's a cache artifact (same `renderId` on reload) versus one that looks stale because
old code is still deployed (an older commit than you expect). Deliberately no try/catch around the
`git` call — if git isn't available the build should fail loudly rather than ship "unknown".

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

**`/deploy-purge` sets `Cache-Control: no-store` on every response it returns** — including the
404. Without it the endpoint is cached like any other route this Worker serves, and the first
attempt's 404 (from racing the secret rotation) gets handed straight back to all seven retries,
which reuse the same token and therefore the same URL. That happened live on 2026-08-06: the deploy
reported `Purge failed after 8 attempts`, while an immediate by-hand rerun succeeded on the first
try purely because it mints a new token, and thus a new URL. The general rule: **a route whose job
is a side effect must opt out of caching, or it will eventually be "called" without running.**

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

**Restore runbook** (written 2026-07-31 — a backup you've never rehearsed restoring is a hope,
not a plan). The realistic failure is a corrupted/wrongly-overwritten `data/pieces.json`; image
bytes are never deleted by the app, so they're almost certainly still in the primary bucket.

1. **Find the snapshot to restore.** `/admin/backups` lists every metadata snapshot key
   (`backups/pieces/<timestamp>.json`, ISO-ordered so the newest-before-the-incident is easy to
   spot). `wrangler` has no object-list command; the dashboard's bucket browser works too.
2. **Fetch and sanity-check it** — does the piece count look right?
   ```
   npx wrangler r2 object get "31-art-website-backups/backups/pieces/<timestamp>.json" --remote --file restored.json
   node -e "console.log(JSON.parse(require('fs').readFileSync('restored.json')).pieces.length, 'pieces')"
   ```
3. **Put it back as the live document:**
   ```
   npx wrangler r2 object put "31-art-website-data/data/pieces.json" --remote --file restored.json --content-type application/json
   ```
4. **Purge pages** — cached pages still show the bad data until then:
   `node scripts/deploy-purge.mjs` (works standalone; it generates a fresh token, no deploy
   needed). Remember purge propagation lags 15–30s — re-verify after waiting, per the Cache
   policy section.
5. **If an image object is actually gone from the primary bucket** (shouldn't happen — the app
   never deletes them): copy it back from the backup bucket by key with the same
   `r2 object get`/`put` pair. Only *masters* are backed up; a lost `sizes` variant is regenerated
   by `scripts/backfill-image-variants.mjs`, which is no longer in the tree — check it out from git
   history (`git log --diff-filter=D -- scripts/backfill-image-variants.mjs`) if that day comes.

**What this doesn't cover**: an off-Cloudflare copy (protecting against, say, the whole Cloudflare
account being compromised or suspended, not just an app bug) — a strictly larger, different threat
model than "bugs in this code" than what was asked for. Both buckets, the auth, and the domain all
live in one Cloudflare account, so one account takeover loses the backups too. The 2026-07-31
review said to stop deferring this; the plan (a small `rclone sync` pull of the backup bucket to a
local disk) is in docs/TODO.md's 2026-07-31 section.

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

**The binding itself is fully gone as of 2026-07-30.** Dropping `env.IMAGES` from the *code* left
the binding still being injected: `@astrojs/cloudflare` wires up Cloudflare Images by default and
emits `"images": {"binding": "IMAGES"}` into the generated deploy config, and `src/env.d.ts` still
declared it — so the Worker kept getting a binding nothing referenced. Fixed by
`cloudflare({ imageService: 'passthrough' })` in `astro.config.mjs` plus deleting the declaration.
Safe because nothing here uses `astro:assets` at all: every image is a plain `<img>` at a
pre-generated R2 variant, and the only bundled image imports (Leaflet's marker PNGs in
`src/scripts/leafletIcons.ts`) already use `?url` to bypass the pipeline. Verified by diffing
`dist/server/wrangler.json` before and after — the `images` key is gone, `ART_BUCKET`,
`BACKUP_BUCKET` and the `SESSION` KV namespace all still present.

**Generation happens at upload, in the browser, at submit time.** The Worker can't resize a
20–30MB scan (Workers memory + no image lib we want to ship there), so `src/scripts/pieceForm.ts`
generates the three WebPs client-side. `setupSubmitWithProgress()` intercepts the form's submit:
for each selected image it runs `makeVariants()` (decode via `createImageBitmap(file,
{imageOrientation: 'from-image'})`, or heic-to's WASM decode for HEIC — see below), appends the
variants to the `FormData` as `asset_<final|extra>_<size>[_i]` fields, and posts everything via
`fetch`, logging progress and surfacing every failure as a visible message instead of a blank error
page. The server (`admin/new.astro` +
`admin/edit/[id].astro`, shared `uploadAsset`, via `getVariantFiles()`) refuses to create an asset
unless all three variant files are present — so a variant-less record is never written. (An
earlier version generated variants at file-*selection* time into hidden inputs via `DataTransfer`
with a ref-counted disabled Save button; the submit-time flow replaced that — one code path, plus
visible progress/errors.)

**That log is deliberately explicit and technical** (owner directive, 2026-08-06) — source format
and size, which decoder ran, decoded dimensions and megapixels, every variant's output dimensions
/ quality / byte size, what the master became and why, elapsed time per image, then the POST's file
count, total bytes, HTTP status and duration. The only person who ever sees this screen is the
site's technical owner, so the useful default is *more* detail, not friendlier summaries: the point
is to notice something odd (a master that came out suspiciously small, a photo that decoded to
unexpected dimensions, a step that suddenly takes 30s) while it's happening rather than months
later. Anything added to this flow should be logged at the same level of detail:

```
[main image]
IMG_5782.HEIC — image/heic, 4.5 MB
Decoding HEIC with heic-to (libheif/WASM) — orientation applied by the decoder…
Decoded 5712×4284 (24.5 MP).
· thumb: Pica/Lanczos → 240×180 WebP q0.82 — 9 KB
· card: Pica/Lanczos → 1000×750 WebP q0.82 — 105 KB
· big: Pica/Lanczos → 1800×1350 WebP q0.82 — 330 KB
Re-encoding the HEIC master → full-res WebP q0.9 at 5712×4284…
· master: 4.7 MB WebP, from 4.5 MB of HEIC. This replaces the HEIC — it's the only copy kept.
✓ Done in 6.2s.
POST /admin/new — 4 files, 5.1 MB…
HTTP 200 in 3.4s.
✓ Saved. Redirected to https://klauria.art/piece/2026-08-06-…?added=1
```

`makeVariants()` is deliberately isolated behind that one function so the resize/encode engine is
swappable. It uses **Pica** (Lanczos downscale — sharper than a plain canvas draw — tiled
internally so large scans don't hit Safari's canvas-area limit), then WebP-encodes at quality
0.82. The initial rollout used a bare `<canvas>` draw (zero dependency, couldn't be
browser-verified at the time); Pica replaced it. **wasm-vips** was considered too but needs
SharedArrayBuffer/cross-origin isolation headers, which would complicate the admin map/geocoding
fetches — Pica needs none of that.

**HEIC uploads** (the default phone-camera format) are handled by **heic-to** (libheif in WASM):
`createImageBitmap` can't decode HEIC outside Safari, so the variant pipeline decodes HEIC through
heic-to instead (libheif applies the container's orientation during decode, so no separate EXIF
step on that path). **A HEIC upload's master is a full-resolution WebP encoded from that same
decode** (quality 0.9, vs 0.82 for the three variants) — implemented 2026-08-06. PNG/JPEG uploads
are untouched, stored byte-for-byte as always.

The reasoning (an owner decision, 2026-07-31): this site is an archive of the *artwork*, and the
artwork arrives as PNG scans, which stay pristine. Phone photos — progress/reference/setup shots —
were never pristine here to begin with, and their real originals live in iCloud, backed up as a
personal-life concern entirely separate from this site. So one good lossy copy is the master, the
"original", and the full-res view at once. Something has to re-encode a HEIC regardless, since
nothing outside Safari can display one; the only question was what to re-encode it *to*.

This replaced `pngIfHeic()`-on-the-upload-path, which stored a **lossless PNG** — ~7× larger (a
measured 4.5MB 24.5MP photo became 32MB) while being no more original than the bytes it was made
from. `pngIfHeic()` still exists, but only to make a HEIC previewable in an `<img>` on the form.
**Structurally the important rule is one decompress, four compresses**: all four encodes read the
one decoded bitmap directly. Deriving the master from a variant (or a variant from the master)
would be a pointless second lossy generation.

**No migration was needed**, verified against production metadata: zero HEIC-converted PNG masters
exist. All 158 phone-photo masters are JPEGs and every PNG master is a scanner-dimensioned artwork
scan. Uploads all come from desktop Firefox dragging out of macOS Photos, and raw .heic drops
definitely happen at least sometimes (they used to fail outright — that's why the heic-to code
exists), but the exact rule for when a drag delivers JPEG vs .heic was never pinned down (EXIF
survives conversion, so it can't distinguish shot-as-JPEG from converted-on-export). So this is
protection for the HEIC case whenever it occurs, **not** a reclaim of existing waste — R2 storage
is dominated by the artwork scans, which are the archive and stay untouched. Known consequence,
accepted: `getImageDimensions()` parses PNG/JPEG headers only, so a WebP master records `0,0` — the
already-existing fallback, which just omits the `width`/`height` attributes.

**The same submit path refuses a too-small image.** `makeVariants()` decodes every upload anyway, so
it knows the true pixel size: under 1500px on the long side, the submit stops behind a `confirm()`.
That's the iCloud "Optimize Mac Storage" gotcha failing loudly — dragging a photo out of macOS
Photos while its original lives only in iCloud silently hands over a ~1024px preview, which is how
59 permanently low-res masters got archived before anyone noticed (see docs/TODO.md's 2026-07-31
section).

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

**Both of those scripts were deleted on 2026-08-06** — they were one-time migrations, both long
since run to completion against production. They're described here (and live in git history)
because the *lessons* in them — EXIF orientation in every generation path, sharp's filename-keyed
metadata cache — still apply to anything that regenerates variants later.

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
- **Access is hostname-scoped, so `workers_dev` must stay off.** The Access application matches
  `klauria.art/admin*` — a *hostname* pattern. It never covered
  `31-art-website.klauria.workers.dev`, so while `workers_dev: true` was set, every `/admin/*`
  route was reachable there with no authentication whatsoever. Found on 2026-07-30 during a
  pre-publication audit; fixed by `"workers_dev": false` in `wrangler.jsonc`, which deletes that
  hostname (verified: all admin paths now 404 there, `klauria.art` unaffected since the custom
  domain is attached separately). **If `workers_dev` is ever turned back on, admin is wide open
  again** — Access will not follow it. The general rule: any new hostname pointing at this Worker
  needs its own Access application, because the app-side has no auth of its own.
- **No in-app auth check. Access is the only gate** (removed 2026-07-30). There used to be a
  defense-in-depth `isAuthorizedAdminRequest()` (`src/lib/adminGuard.ts`) comparing
  `Cf-Access-Authenticated-User-Email` against an `ADMIN_EMAIL` Worker secret at the top of every
  mutation handler. The owner flagged it as pointless complexity and it's gone, along with the
  secret and its type declaration: Access is verified working (a `302` to login before the Worker
  runs at all), and the check no-op'd whenever `ADMIN_EMAIL` was unset — which was true for all of
  local dev — so it never ran anywhere except production, where Access had already done the job.
  Four call sites got simpler. If a second editor is ever added, the answer is another Access
  policy, not application code.

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

An **activity bar chart**, now **two levels: year bars by default, click a year to drill into its
month bars** — bar height is how many pieces were made in that year/month, and each bar is stacked
by medium (gouache/watercolor/sketchbook page) so it reads *how much* and *what kind* of work at a
glance. One flat row of every month ever was the first version, but at 10+ years that's 120+ bars
squeezed too thin to tap (especially on mobile) and only getting worse; year bars are naturally
bounded (one per year), and a drilled-into year shows at most 12 month bars. A breadcrumb ("All
years › 2013 › May") tracks the depth and its segments jump back up, like a directory path.
Clicking a year (or its crumb) browses *every* piece from that year in the gallery frame below,
not just a month at a time. This replaced an earlier `<input
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

A tag cloud on the home page — every distinct tag across all pieces, via the existing
`getTagFrequency()` (already built for the admin form's tag-suggestion chips), rendered as
`tag-chip` links sized on a simple linear scale between the least- and most-used tag, linking to
`/tag/<slug>`. No separate index page; this is the one place all tags are browsable from.

**Tags are grouped into display categories** (Medium / Type / Trip-era / Place / Subject / …) by
`src/lib/tagCategories.ts` — a hardcoded list, used by both the public cloud and the admin tag
pickers. This is purely display grouping, not schema: a tag still belongs to nothing but the
piece's free-form `tags` array, and an uncategorized tag just falls into "Other" rather than
breaking anything. Hardcoded rather than admin-editable on purpose — the vocabulary is small and
grows rarely, and nothing has to be edited here for a new tag to *work*, only for it to be grouped
nicely.

`/tag/<slug>` supports `?sort=asc` (oldest-first instead of the default newest-first) — used by
the home page's intro links (e.g. "first marks") where chronological reading order is the point.

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
  top-to-bottom: a short personal intro (with links into `/tag/...?sort=asc` chronological reads)
  → favorites → Map → recent pieces → Tags → random pieces → Timeline → the lifetime/year stat at
  the very bottom (moved there from a boxed callout near the top, since it's "a stat I wanna look
  at," not something a visitor needs first). Real art keeps appearing between the "explore by X"
  tools rather than being front-loaded once, matching explicit feedback: "a user comes in and it's
  like they're surrounded by my images, and then there's ways for them to enter in and see more."
- **The favorites/recent/random batches are carousels now** (`Carousel.astro` +
  `src/scripts/carousel.ts`), not `piece-grid` batches: a horizontal scroll-snap track showing one
  big piece at a time, with prev/next buttons that just `scrollBy` one viewport (dimmed at the
  ends) — native swipe works for free, the JS only wires the buttons. Each carousel keeps a small,
  quiet `.section-label` ("My favorite pieces I've made" / "Some recent pieces" / "Some random
  pieces"), deliberately not a heavy `<h2>` like Map/Timeline/Tags get, since these are still just
  "more art," not another explore-by-X tool. The `piece-grid large` treatment described above
  still applies to `/tag/<slug>` and `/kind/<kind>` pages.

## Admin form conveniences

Small quality-of-life additions to the new/edit piece forms (`src/scripts/pieceForm.ts`), each
following the same rule: never clobber a value the owner already set on purpose.

- **Drag-and-drop upload**: images can be dragged straight from Photos/Finder onto a
  `.dropzone[data-drop-for]` instead of the scroll-heavy file picker. Dropped files are loaded
  into the referenced file input and a `change` event fired, so every existing
  preview/kind-tagging/suggestion handler treats them exactly like picked files — no second code
  path. Drops on the multi-file "additional photos" input *accumulate* (so you can drop one photo
  at a time), and each row has a Remove button; chosen kinds survive the list rebuilding by
  keying on file identity (name:size:mtime), since File objects have no stable id.
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
- **`/admin/favorites` drag-to-reorder, via SortableJS** (2026-07-30). Favorites used to be an
  editable numeric rank field per row, which meant renumbering by hand. It's now drag-by-handle:
  each favorited `<li>` carries a hidden repeated `favorite_order` input, and the browser submits
  repeated fields in DOM order, so dragging a row *is* the edit — there's no rank to type and
  nothing to renumber. The two lists (`#favList` / `#restList`) are the favorite/not-favorite
  state: the ★/Remove buttons just move an `<li>` between them, adding or removing its hidden
  input on the way.
  - **The drag itself is `sortablejs`, not hand-rolled.** Three hand-rolled pointer-event attempts
    each fixed one symptom and revealed the next: text selection instead of dragging (a
    `preventDefault()` on `pointerdown` does *not* prevent this for mouse pointers — browsers only
    suppress the compatibility mouse events for *touch* pointers, so a real `mousedown` still
    fires and starts a selection); then a row that snapped back to its origin on every no-op
    reinsert; then a cursor that reverted to the default arrow the moment it left the handle. The
    library owns all of it — the element following the cursor, the gap opening where it would
    land, and touch support. Native HTML5 drag-and-drop is not an option here: iOS Safari doesn't
    implement it, and this list is meant to be usable from a phone. `forceFallback: true` makes
    Sortable use its own cloned drag element on desktop too, instead of the browser's native drag
    image, so desktop and touch behave identically. Net effect was 33 lines of hand-rolled JS
    deleted for 5 lines of config. **This costs the public site nothing** — it's imported by one
    admin page, and admin routes are `no-store` and single-user, so bundle size there is close to
    irrelevant.
  - **Astro's scoped CSS is why the handles are rendered on every row, including non-favorites**
    (hidden via `#restList .drag-handle { display: none }`) rather than created in JS when a piece
    is favorited. A component's `<style>` compiles to attribute selectors
    (`.drag-handle[data-astro-cid-…]`), and only elements Astro renders from the template carry
    that attribute — so a `document.createElement('span')` handle matched *none* of the rules and
    came out unstyled next to its server-rendered neighbours. Worth remembering for any other
    dynamically-built DOM in this codebase: JS-created elements silently opt out of scoped styles.
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
- `/piece/<id>` — full detail, static-feeling page (SSR + cached). Below the piece itself, two
  ways to keep exploring from where you are: **"Around this time"** (a strip of up to 3
  chronological neighbors each side, via `getTimelineNeighbors()`) and **"Nearby"** (a small
  Leaflet map, `src/scripts/nearbyMap.ts`, pinning up to 10 other pieces within 100 miles via
  `getNearbyPieces()` — both a count *and* a radius cap, so an isolated piece isn't padded out
  with pins hundreds of miles away).
- `/tag/<slug>` — one template, covers medium tags, trip tags, and any other descriptive tag.
- `/kind/<kind>` — one template, covers every asset kind (`/kind/setup`, `/kind/value-study`, ...);
  same big image-forward `piece-grid large` treatment as the home page, not a small thumbnail list.
- `/admin` — upload form, edit-piece form, favorites reorder, bulk tagging — plain HTML forms with
  full-page-reload submits. Favorites are reordered by dragging a row's handle (see **Admin form
  conveniences**), not by typing rank numbers.
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
- ~~Removing the now-fully-dead `pinnedLinks` field/type~~ **done 2026-07-30**, along with the
  `ADMIN_EMAIL` defense-in-depth check — see the Metadata storage and Auth sections. The broader
  codebase complexity audit the owner asked for is still open, tracked in docs/TODO.md's standing
  simplicity-audit section.
