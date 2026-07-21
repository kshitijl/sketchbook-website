/**
 * Serves an R2-stored asset directly (see src/pages/img/[...key].ts). Cloudflare Image
 * Transformations (`/cdn-cgi/image/...`) only exist on Cloudflare's real edge network, not in
 * local dev, so this is a plain passthrough for now — wrapping it with real
 * resizing/format-negotiation once this is actually deployed is still a Phase 3 follow-up (see
 * docs/TODO.md).
 */
export function imageUrl(r2Key: string): string {
	return `/img/${r2Key}`;
}
