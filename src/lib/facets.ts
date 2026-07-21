import type { Asset, AssetKind, Piece, PiecesData } from './types';

export function getPieceById(data: PiecesData, id: string): Piece | undefined {
	return data.pieces.find((p) => p.id === id);
}

/** The image to show as a piece's thumbnail/cover — the final piece if there is one, else
 * whatever's first. */
export function getPrimaryAsset(piece: Piece): Asset | undefined {
	return piece.assets.find((a) => a.kind === 'final') ?? piece.assets[0];
}

export function getPiecesByTag(data: PiecesData, slug: string): Piece[] {
	return data.pieces
		.filter((p) => p.tags.includes(slug))
		.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export interface AssetWithPiece {
	piece: Piece;
	asset: Piece['assets'][number];
}

export function getAssetsByKind(data: PiecesData, kind: AssetKind): AssetWithPiece[] {
	const results: AssetWithPiece[] = [];
	for (const piece of data.pieces) {
		for (const asset of piece.assets) {
			if (asset.kind === kind) {
				results.push({ piece, asset });
			}
		}
	}
	return results.sort((a, b) => (a.piece.date < b.piece.date ? 1 : -1));
}

export function getPiecesByDateDescending(data: PiecesData): Piece[] {
	return [...data.pieces].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPiecesByPlace(data: PiecesData): Map<string, Piece[]> {
	const byPlace = new Map<string, Piece[]>();
	for (const piece of getPiecesByDateDescending(data)) {
		const place = piece.location.placeName;
		const list = byPlace.get(place);
		if (list) {
			list.push(piece);
		} else {
			byPlace.set(place, [piece]);
		}
	}
	return byPlace;
}

export interface TagFrequency {
	tag: string;
	count: number;
}

/** Previously-used tags, most-used first — powers the clickable tag suggestions in the admin form. */
export function getTagFrequency(data: PiecesData): TagFrequency[] {
	const counts = new Map<string, number>();
	for (const piece of data.pieces) {
		for (const tag of piece.tags) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Rough medium classification used to derive "phases" (drawing-heavy vs painting-heavy
 * stretches) automatically from tags, instead of a manually maintained field. */
const DRY_MEDIA = new Set(['pencil', 'ink']);
const WET_MEDIA = new Set(['watercolor', 'gouache', 'oil', 'acrylic']);

export type MediumGroup = 'dry' | 'wet' | 'unclassified';

export function classifyMedium(tags: string[]): MediumGroup {
	const hasDry = tags.some((t) => DRY_MEDIA.has(t));
	const hasWet = tags.some((t) => WET_MEDIA.has(t));
	if (hasWet && !hasDry) return 'wet';
	if (hasDry && !hasWet) return 'dry';
	return 'unclassified';
}

/**
 * Working definition of "painting" (as opposed to a drawing or a quick study): a *finished* piece
 * tagged with at least one wet medium — checked directly against the tag, not via
 * classifyMedium(), so a mixed piece (e.g. ink *and* watercolor) still counts rather than falling
 * into "unclassified". This is a first guess, not a confirmed definition from the artist — revisit
 * if it doesn't match how they actually count. See docs/TODO.md.
 */
export function isPainting(piece: Piece): boolean {
	return piece.stage === 'finished' && piece.tags.some((t) => WET_MEDIA.has(t));
}

export interface PaintingStats {
	lifetimeCount: number;
	year: number;
	yearCount: number;
	nextYearMilestone: number;
	remainingForYearMilestone: number;
}

/** Powers the "N paintings this year, M more to the next hundred" landing-page counter. */
export function getPaintingStats(data: PiecesData, now: Date): PaintingStats {
	const year = now.getFullYear();
	const paintings = data.pieces.filter(isPainting);
	const lifetimeCount = paintings.length;
	const yearCount = paintings.filter((p) => p.date.startsWith(String(year))).length;
	const nextYearMilestone = (Math.floor(yearCount / 100) + 1) * 100;
	const remainingForYearMilestone = nextYearMilestone - yearCount;
	return { lifetimeCount, year, yearCount, nextYearMilestone, remainingForYearMilestone };
}
