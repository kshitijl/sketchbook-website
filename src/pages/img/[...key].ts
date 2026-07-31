import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

/**
 * Serves an image object from R2, byte-for-byte. Both masters and the pre-generated WebP variants
 * are just plain immutable objects under versioned keys (see src/lib/images.ts) — there is no
 * on-the-fly resizing anymore, so this is a dumb passthrough. Keys are never reused, so the response
 * is safe to cache forever.
 */
/**
 * ART_BUCKET holds exactly two things: images under `assets/<pieceId>/...` (written by
 * assetR2Key() in src/lib/ids.ts) and the metadata document at `data/pieces.json`. Without this
 * prefix check the route is an unrestricted read proxy for the whole bucket, and
 * `/img/data/pieces.json` hands out the entire metadata document — found during the 2026-07-30
 * pre-publication audit. Every key the site actually requests is under `assets/`, so this costs
 * nothing and blocks everything else, including anything added to the bucket later.
 */
const SERVABLE_PREFIX = 'assets/';

export const GET: APIRoute = async ({ params }) => {
	const key = params.key;
	// `..` can't traverse in R2 (keys are opaque strings, not paths), but a key containing it is
	// never one of ours, so there's no reason to look it up.
	if (!key || !key.startsWith(SERVABLE_PREFIX) || key.includes('..')) {
		return new Response('Not found', { status: 404 });
	}

	const object = await env.ART_BUCKET.get(key);
	if (!object) {
		return new Response('Not found', { status: 404 });
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	headers.set('Cache-Control', 'public, max-age=31536000, immutable');
	return new Response(object.body, { headers });
};
