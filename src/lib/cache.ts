/**
 * Invalidation is purge-driven, not TTL-driven: every successful admin write calls `purgePages()`
 * (see src/lib/purge.ts, called from the admin write handlers), so Workers Cache's copy of every
 * page is invalidated the instant something changes. See docs/architecture.md. The values below
 * are a generous ceiling, not the actual freshness mechanism — Astro reruns on every edit (via
 * purge) and otherwise at most once every 30 days:
 *
 * - `s-maxage` (Workers Cache — the cache in front of the Worker itself): 30 days. Purge — not
 *   expiry — is what keeps this fresh in the normal case; a missed/failed purge is self-healing
 *   since the *next* edit purges everything again regardless of what it touched.
 * - `max-age` (the visitor's own browser): 1 minute. Deliberately short (rather than, say, an
 *   hour) mainly so the site owner can debug locally/in production without constantly clearing
 *   their own browser cache — traffic between a browser and Cloudflare's edge for a re-ask is
 *   cheap regardless, since the edge already has the fresh (purged-and-rerendered) response
 *   cached and ready; this value has no bearing on how often Astro's render code actually runs.
 */
export const PAGE_CACHE_CONTROL = 'public, max-age=60, s-maxage=2592000'; // 1min browser, 30 days edge

/**
 * Every actual page (never `/admin/*` — always `no-store`, never cached at all — and never
 * `/img/*`, which manages its own separate, deliberately-forever `Cache-Control` independently)
 * carries this `Cache-Tag`. `purgePages()` purges only responses carrying it, so an admin write's
 * purge invalidates every currently-cached page without also nuking the completely unrelated
 * resized-image cache, which never needs invalidating since its keys are versioned and never
 * reused. See src/lib/purge.ts and docs/architecture.md's Cache policy section.
 */
export const PAGE_CACHE_TAG = 'page';

/** Sets both headers together on a page response — use this instead of setting `Cache-Control`
 * directly, so a page can never end up cached but untagged (and therefore unpurgeable by
 * `purgePages()`). */
export function setPageCacheHeaders(headers: Headers): void {
	headers.set('Cache-Control', PAGE_CACHE_CONTROL);
	headers.set('Cache-Tag', PAGE_CACHE_TAG);
}
