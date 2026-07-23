import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

/**
 * Serves an image object from R2, byte-for-byte. Both masters and the pre-generated WebP variants
 * are just plain immutable objects under versioned keys (see src/lib/images.ts) — there is no
 * on-the-fly resizing anymore, so this is a dumb passthrough. Keys are never reused, so the response
 * is safe to cache forever.
 */
export const GET: APIRoute = async ({ params }) => {
	const key = params.key;
	if (!key) {
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
