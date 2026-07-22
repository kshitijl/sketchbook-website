import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { SIZE_WIDTHS, type ImageSize } from '../../lib/images';

function isImageSize(value: string | null): value is ImageSize {
	return value === 'thumb' || value === 'card' || value === 'big';
}

function passthrough(object: R2ObjectBody): Response {
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	// Keys are versioned and never reused (see src/lib/ids.ts), so this is safe to cache forever.
	headers.set('Cache-Control', 'public, max-age=31536000, immutable');
	return new Response(object.body, { headers });
}

export const GET: APIRoute = async ({ params, url }) => {
	const key = params.key;
	if (!key) {
		return new Response('Not found', { status: 404 });
	}

	const object = await env.ART_BUCKET.get(key);
	if (!object) {
		return new Response('Not found', { status: 404 });
	}

	// `?size=` is the resized/re-encoded path (see src/lib/images.ts) — no query param at all
	// means the untouched original, e.g. for a "view full resolution" link.
	const size = url.searchParams.get('size');
	const contentType = object.httpMetadata?.contentType ?? '';

	if (isImageSize(size) && contentType.startsWith('image/')) {
		try {
			const transformed = await env.IMAGES.input(object.body)
				.transform({ width: SIZE_WIDTHS[size], fit: 'scale-down' })
				.output({ format: 'image/webp' });
			const response = transformed.response();
			response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
			return response;
		} catch {
			// Best-effort: the resize failed (corrupt/unsupported image, transform error, etc.).
			// `object.body` may already be partially consumed by the failed attempt, so re-fetch a
			// fresh copy rather than risk returning a truncated body.
			const fresh = await env.ART_BUCKET.get(key);
			return fresh ? passthrough(fresh) : new Response('Not found', { status: 404 });
		}
	}

	return passthrough(object);
};
