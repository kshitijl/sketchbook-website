export type ImageSize = 'thumb' | 'card' | 'big';

/** Shared between the URL builder here and the actual resize in src/pages/img/[...key].ts — a
 * small fixed set of buckets, not one arbitrary width per container, keeps the number of distinct
 * (source image, size) transformations bounded (Cloudflare Images bills and Workers Cache caches
 * each unique combination separately) instead of fragmenting across every possible pixel width. */
export const SIZE_WIDTHS: Record<ImageSize, number> = {
	thumb: 240,
	card: 1000,
	big: 1800
};

/**
 * A resized, re-encoded variant for on-page display — never the original bytes. `size` is
 * required, not defaulted, so every call site makes a conscious choice instead of silently
 * inheriting whatever a default happened to be.
 */
export function imageUrl(r2Key: string, size: ImageSize): string {
	return `/img/${r2Key}?size=${size}`;
}

/** The untouched original file exactly as uploaded — no resizing, no re-encoding. Used sparingly
 * (e.g. a "view full resolution" link), not for anything embedded directly on a page. */
export function originalImageUrl(r2Key: string): string {
	return `/img/${r2Key}`;
}
