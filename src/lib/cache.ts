/**
 * Invalidation is purge-driven, not TTL-driven: every successful admin write triggers a
 * Cloudflare "purge everything" API call (implemented in Phase 5, alongside the admin write
 * handlers that are its only caller), so Cloudflare's edge copy is invalidated the instant
 * something changes. See docs/architecture.md. The values below are a generous ceiling, not the
 * actual freshness mechanism — Astro reruns on every edit (via purge) and otherwise at most once
 * every 30 days:
 *
 * - `s-maxage` (Cloudflare's edge): 30 days. Purge — not expiry — is what keeps this fresh in the
 *   normal case; a missed/failed purge is self-healing since the *next* edit purges everything
 *   again regardless of what it touched.
 * - `max-age` (the visitor's own browser): 1 minute. Deliberately short (rather than, say, an
 *   hour) mainly so the site owner can debug locally/in production without constantly clearing
 *   their own browser cache — traffic between a browser and Cloudflare's edge for a re-ask is
 *   cheap regardless, since the edge already has the fresh (purged-and-rerendered) response
 *   cached and ready; this value has no bearing on how often Astro's render code actually runs.
 */
export const PAGE_CACHE_CONTROL = 'public, max-age=60, s-maxage=2592000'; // 1min browser, 30 days edge

export function applyPageCacheHeaders(response: Response): Response {
	response.headers.set('Cache-Control', PAGE_CACHE_CONTROL);
	return response;
}
