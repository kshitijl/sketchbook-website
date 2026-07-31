# Architecture review — 2026-07-31

A full read of the docs and codebase plus live production numbers (via `wrangler`), asked for
directly by the owner: "figure out if/how we can simplify or improve this website... rock-solid,
simple, dumb, fast, and free for me to keep running it on Cloudflare's infrastructure free tier."
Focus per the owner: overall architecture, storage, caching, and long-term maintainability — not
code nits.

**Verdict: the architecture is sound and already matches the stated priorities; nothing structural
should change.** The two things that actually threaten the goals are storage growth (the R2 free
tier runs out around ~200 pieces at current rates) and `docs/architecture.md` having drifted from
the code (which undermines the "docs are the memory" maintenance model this repo runs on).

## Storage — the one place "free" actually breaks

Measured in production on 2026-07-31:

- 120 pieces, 293 assets, `data/pieces.json` = 220 KB
- Primary bucket (`31-art-website-data`): **3.01 GB**, 1,347 objects
- Backup bucket (`31-art-website-backups`): **2.8 GB**, 705 objects
- Total: **5.8 GB of R2's 10 GB free tier**, i.e. ~48 MB per piece across both buckets, dominated
  by masters (all 293 variants together are only ~130 MB)

At this rate the free tier is exhausted around **~200 pieces** — well short of the 500–1,000-piece
design target. Two honest options:

1. **Accept it.** Past 10 GB, R2 is $0.015/GB-month with zero egress fees. The full 1,000-piece
   collection at current rates is ~50 GB ≈ **$0.60/month**, and everything else in the stack
   (Workers requests, KV, cron, Access, cache) stays comfortably free forever.
2. **If free is a hard constraint, the lever is masters — specifically HEIC conversion.**
   `pngIfHeic()` re-encodes every phone photo to lossless PNG *before storing it as the "pristine
   master"*, inflating a ~2 MB HEIC to ~10–20 MB. The truly pristine original is the HEIC bytes as
   uploaded; storing those instead is simpler *and* several times smaller for every phone photo
   (reference/setup/in-progress shots are 173 of the 293 assets). See the 2026-07-31 TODO section
   for the full plan — after discussion, the owner's decision landed on a third option: re-encode
   HEIC to one high-quality full-res WebP as the master, since phone photos aren't archival the
   way the PNG artwork scans are (their true originals live in iCloud). Measured on a real 24.5MP
   sample: 4.5MB HEIC → 32MB as today's lossless PNG vs 4.7MB as the q90 WebP master — ~7×
   savings per phone photo.

   **Correction, same day**: a direct check of production metadata (while planning the one-time
   re-encode of existing HEIC-PNGs) showed the inflation has never actually happened — all 158
   phone-photo masters are JPEGs, all 103 PNG masters are scanner-dimensioned artwork scans, zero
   PNGs at iPhone camera dimensions. Uploads all come from desktop Firefox dragging out of macOS
   Photos; raw .heic drops happened at least sometimes (they used to fail outright, which is why
   the HEIC code was written), but the exact JPEG-vs-.heic rule wasn't pinned down — EXIF
   survives conversion, so it can't distinguish shot-as-JPEG from converted-on-export. The same
   dimension check surfaced a real data-quality find: **59 phone-photo masters (~20% of all
   assets) are 1024×768-class iCloud previews, not full photos** — the macOS Photos
   "Optimize Mac Storage" drag gotcha (verified by EXIF: a real iPhone SE photo stored at
   1024×768). Originals are safe in iCloud; TODO'd with a re-upload list option and a
   fail-loud small-image warning for the upload path. So current storage is dominated by the artwork scans themselves, which are the
   archive and non-negotiable — meaning **the free-tier horizon (~200 pieces) stands regardless
   of the HEIC fix**, which is protection for the recurring raw-.heic drag-and-drop case, not a
   reclaim. Practically, option 1 (accept ~$0.60/month at full
   scale) is the answer — the owner confirmed: ~200 artworks × 20–30 MB is basically the 10 GB,
   and that's fine. No one-time migration of existing masters is needed or planned.

Forward-looking caution: the Workers **free** plan caps CPU at 10 ms per invocation. A render
parses the whole JSON document (220 KB now, ~2 MB at full scale) and renders the page. Caching
makes renders rare, so this may never bite — but if pages mysteriously start erroring on cache
misses at 800+ pieces, this is why.

## Caching — correct, leave it alone

Purge-on-write is right for the stated goal and has been corrected against reality twice already
(zone purge no-op, Cache Rules no-op — see architecture.md). Nothing to fix. One awareness item:
Workers Cache + in-Worker `cache.purge({tags})` is the newest, least-boring Cloudflare surface in
the whole stack — everything else (R2, Access, cron, Leaflet) is decade-boring.
`scripts/check-caching.mjs` is the canary for it; keep it and run it after wrangler/adapter
upgrades.

## Maintainability findings

1. **architecture.md had drifted from the code** — the highest-leverage fix, since the maintenance
   model (per CLAUDE.md) is that every session reads and *trusts* it. Specifics at review time,
   all fixed in the same pass as this review:
   - The Images section described bare-`<canvas>` variant generation at file-selection time into
     hidden inputs with a ref-counted disabled Save button, and listed Pica as a *future* upgrade.
     The code actually uses Pica + heic-to, generates at submit time, and posts via `fetch` with a
     progress log. HEIC handling (masters converted to PNG — storage-relevant) wasn't in the doc
     at all.
   - Built after the doc's last real content update and absent from it entirely: the home-page
     carousels, the per-piece "Nearby" map and "Around this time" strip, the two-level
     year→month timeline drill-down, tag categories (`tagCategories.ts`), and the drag-and-drop
     upload zones. Most were in neither architecture.md nor TODO.md — only code and commit
     messages.
2. **Backups existed; restore didn't.** No written procedure for which snapshot key to grab, how
   to copy it back, and that a purge must follow. Fixed: architecture.md's Backups section now has
   a restore runbook.
3. **Everything lives in one Cloudflare account** — primary, backups, auth, domain. At 5.8 GB an
   occasional `rclone sync` of the backup bucket to a disk at home closes the "account
   compromised/suspended" hole for near-zero effort. The collection is already
   irreplaceable-sized; stop deferring this one. (TODO'd 2026-07-31.)
4. **One leftover binding, same class as the removed IMAGES one**: the Astro adapter
   force-enables KV-backed sessions and auto-provisioned a `31-art-website-session` KV namespace
   that nothing uses (`Astro.session` appears nowhere). Inert and free, but exactly the kind of
   unrequested machinery this repo strips. (TODO'd 2026-07-31.)
5. Minor dead code, noted not urgent: `getPiecesByPlace()` in `src/lib/facets.ts` has no callers;
   `scripts/backfill-image-variants.mjs` and `scripts/reorient-image-variants.mjs` are completed
   one-time migrations (git history keeps them if deleted).

## What was explicitly *not* flagged

Things a fresh reviewer might flag that are correct for this site and mostly documented as
deliberate: the single JSON metadata document (220 KB, cheap, no database), full page-tag purge on
any write, the separate boring backup worker, plain full-page-reload admin forms, and the 59
pure-logic Vitest tests (fast, real invariants — they pull their weight). The three pages on
`docs/kl-todo.md` (about, easel setup, sketchbooks) all fit the existing architecture trivially —
static-ish Astro pages plus the `/kind/setup` machinery that already exists.
