import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

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
	// Keys are versioned and never reused (see src/lib/ids.ts), so this is safe to cache forever.
	headers.set('Cache-Control', 'public, max-age=31536000, immutable');

	return new Response(object.body, { headers });
};
