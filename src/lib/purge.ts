import { cache } from 'cloudflare:workers';

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
 * Failures are swallowed rather than surfaced: a missed purge self-heals on the next write's purge
 * call regardless of what that next write touches.
 */
export async function purgeEverything(): Promise<void> {
	try {
		await cache.purge({ purgeEverything: true });
	} catch {
		// Best-effort — see comment above. Also expected to no-op/fail harmlessly under local dev,
		// where there's no real Workers Cache to purge.
	}
}
