import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { purgeEverything, purgePages } from '../lib/purge';

/**
 * Purge-on-write (see src/lib/purge.ts) only fires from admin write handlers, which all require a
 * live Cloudflare Access login — meaning a pure code deploy with no accompanying data edit never
 * purges the cache. Found live (2026-07-22): a route removed in a deploy kept serving its old,
 * now-nonexistent page from a still-fresh Workers Cache entry, aging well past the deploy. Gated
 * by a shared-secret query param (not Cloudflare Access) since this needs to be callable from a
 * deploy script/CLI session, not a browser login. 404s (not 403) on any mismatch or if the secret
 * isn't set, so its existence isn't advertised.
 *
 * Purges only pages by default (`purgePages()`), same as an admin write — a code deploy can only
 * ever change what a page *renders*, never what a previously-resized image looks like. `?full=1`
 * is an escape hatch to `purgeEverything()` for the rare case something needs a hard reset (e.g.
 * a change to the cache-tagging scheme itself, which needs one full flush to take effect for
 * anything cached under the old scheme).
 */
// `no-store` on every response, same as `/admin/*`: this endpoint is served by the same Worker
// through the same Workers Cache as everything else, and without it the cache poisons the deploy
// script's own retry loop. Seen live 2026-08-06: attempt 1 raced the secret rotation and 404'd,
// that 404 got cached, and all 7 retries (same URL, same token) read the cached 404 back instead
// of ever reaching the Worker again — so the 8×5s retry budget bought nothing and the deploy
// reported a purge failure that had already fixed itself. Confirmed by curling one bad-token URL
// three times: `cf-cache-status: MISS`, then `HIT`, then `HIT`.
const NO_STORE = { 'Cache-Control': 'no-store' };

export const GET: APIRoute = async ({ url }) => {
	const token = url.searchParams.get('token');
	if (!env.DEPLOY_PURGE_TOKEN || token !== env.DEPLOY_PURGE_TOKEN) {
		return new Response('Not found', { status: 404, headers: NO_STORE });
	}
	if (url.searchParams.get('full') === '1') {
		await purgeEverything();
		return new Response('purged everything', { headers: NO_STORE });
	}
	await purgePages();
	return new Response('purged', { headers: NO_STORE });
};
