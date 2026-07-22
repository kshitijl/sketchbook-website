import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { purgeEverything } from '../lib/purge';

/**
 * Purge-on-write (see src/lib/purge.ts) only fires from admin write handlers, which all require a
 * live Cloudflare Access login — meaning a pure code deploy with no accompanying data edit never
 * purges the cache. Found live (2026-07-22): a route removed in a deploy kept serving its old,
 * now-nonexistent page from a still-fresh Workers Cache entry, aging well past the deploy. Gated
 * by a shared-secret query param (not Cloudflare Access) since this needs to be callable from a
 * deploy script/CLI session, not a browser login. 404s (not 403) on any mismatch or if the secret
 * isn't set, so its existence isn't advertised.
 */
export const GET: APIRoute = async ({ url }) => {
	const token = url.searchParams.get('token');
	if (!env.DEPLOY_PURGE_TOKEN || token !== env.DEPLOY_PURGE_TOKEN) {
		return new Response('Not found', { status: 404 });
	}
	await purgeEverything();
	return new Response('purged');
};
