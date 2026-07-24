export type AssetKind =
	| 'final'
	| 'unsorted'
	| 'reference-photo'
	| 'in-progress'
	| 'value-study'
	| 'setup';

export interface Asset {
	id: string;
	kind: AssetKind;
	/** The pristine original, exactly as uploaded — the archive's preservation master. Only ever
	 * served by "View full resolution"; never embedded on a page. */
	r2Key: string;
	/** Pre-generated, web-serving WebP variant keys — one per display size. Generated at upload time
	 * (client-side) and by the backfill; every asset always has all three. Not optional: a missing
	 * variant is a bug to fix, not a state to tolerate (no master fallback — see docs/architecture.md).
	 * `imageUrl(asset, size)` in images.ts resolves the right one. */
	sizes: { thumb: string; card: string; big: string };
	width: number;
	height: number;
	caption?: string;
}

export interface Location {
	lat: number;
	lng: number;
	placeName: string;
}

export interface Piece {
	id: string;
	title: string;
	date: string; // ISO date, e.g. "2023-11-14"
	location: Location;
	tags: string[];
	notes: string;
	favoriteRank: number | null;
	assets: Asset[];
}

export interface PinnedLink {
	label: string;
	href: string;
}

export interface PiecesData {
	pieces: Piece[];
	pinnedLinks: PinnedLink[];
}

export const EMPTY_PIECES_DATA: PiecesData = {
	pieces: [],
	pinnedLinks: []
};
