import type { Asset } from './types';

export type ImageSize = 'thumb' | 'card' | 'big';

/** The fixed set of display sizes. Every asset has a pre-generated WebP variant at each of these
 * widths (see Asset.sizes in types.ts) — generated once at upload time (client-side) and by the
 * backfill, not resized on demand. Widths are shared by the client generator and the backfill so
 * both produce identical buckets. */
export const SIZE_WIDTHS: Record<ImageSize, number> = {
	thumb: 240,
	card: 1000,
	big: 1800
};

/**
 * URL for a pre-generated variant to embed on a page. `size` is required — every call site makes a
 * conscious choice. Indexes `asset.sizes` directly with no fallback: a missing variant is a bug
 * (see types.ts), so let it surface rather than silently serving the multi-MB master.
 */
export function imageUrl(asset: Asset, size: ImageSize): string {
	return `/img/${asset.sizes[size]}`;
}

/** The untouched original file exactly as uploaded — no resizing, no re-encoding. Used sparingly
 * (e.g. a "view full resolution" link), not for anything embedded directly on a page. */
export function originalImageUrl(r2Key: string): string {
	return `/img/${r2Key}`;
}

/** Pull the three client-generated WebP variant files for one uploaded image out of a FormData,
 * given a function that builds each size's field name (kept in sync with pieceForm.ts's hidden
 * inputs). Returns null if any of the three is missing/empty — callers treat that as a hard
 * validation error, since every image must arrive with all its variants. */
export function getVariantFiles(
	formData: FormData,
	fieldName: (size: ImageSize) => string
): { thumb: File; card: File; big: File } | null {
	const result = {} as { thumb: File; card: File; big: File };
	for (const size of ['thumb', 'card', 'big'] as const) {
		const f = formData.get(fieldName(size));
		if (!(f instanceof File) || f.size === 0) return null;
		result[size] = f;
	}
	return result;
}
