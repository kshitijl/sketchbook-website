import { cache } from 'cloudflare:workers';
import { PAGE_CACHE_TAG } from './cache';

/**
 * Best-effort cache purge after an admin write (see docs/architecture.md's cache policy — purge
 * on write, not TTL expiry).
 *
 * This calls the Workers Cache runtime API (`cache.purge()`), NOT the zone-level Cache Purge HTTP
 * API — a real correction made after live testing showed pages weren't actually being cached at
 * all. Workers Cache (the `"cache": { "enabled": true }` setting in wrangler.jsonc) is a distinct
 * mechanism from ordinary zone/Cache-Rules-based caching, and per Cloudflare's own docs, "no
 * zone-level purge (via the dashboard, API, or Terraform) affects Workers Caching content" — only
 * this in-Worker API does. This also means no external API token is needed for purging at all
 * (unlike the zone HTTP API, which needed a Cache-Purge-scoped credential) — one less piece of
 * account setup.
 *
 * Purges only responses carrying `PAGE_CACHE_TAG` — deliberately not everything. An edit to a
 * piece's title/tags/etc. can only ever change what a *page* renders; it can never change what a
 * previously-resized image looks like (that's keyed by a versioned R2 key that's never reused, so
 * it's correct to cache forever). A blanket `purgeEverything` used to nuke that image cache too on
 * every single admin write, forcing Cloudflare Images to redo resize work that had nothing to do
 * with the edit that triggered the purge — real, avoidable waste at this site's rate of edits.
 *
 * Failures are swallowed rather than surfaced: a missed purge self-heals on the next write's purge
 * call regardless of what that next write touches.
 */
export async function purgePages(): Promise<void> {
	try {
		await cache.purge({ tags: [PAGE_CACHE_TAG] });
	} catch {
		// Best-effort — see comment above. Also expected to no-op/fail harmlessly under local dev,
		// where there's no real Workers Cache to purge.
	}
}

/**
 * Full, indiscriminate purge — an escape hatch, not part of the normal admin-write/deploy path
 * (see `/deploy-purge`'s `?full=1`). Exists for the rare case something needs a hard reset, e.g.
 * the tagging scheme in src/lib/cache.ts itself changes and old untagged entries need flushing.
 */
export async function purgeEverything(): Promise<void> {
	try {
		await cache.purge({ purgeEverything: true });
	} catch {
		// Best-effort — see comment above.
	}
}
