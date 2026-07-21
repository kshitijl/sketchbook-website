/**
 * Uniform short TTL applied to every page and to the data/pieces.json fetch, instead of long
 * caching + manually computing which pages an edit affects. See docs/architecture.md.
 */
export const PAGE_CACHE_CONTROL = 'public, max-age=60';

export function applyPageCacheHeaders(response: Response): Response {
	response.headers.set('Cache-Control', PAGE_CACHE_CONTROL);
	return response;
}
