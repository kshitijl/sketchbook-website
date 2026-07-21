import type { AssetKind, Piece, PiecesData } from './types';

export function getPieceById(data: PiecesData, id: string): Piece | undefined {
	return data.pieces.find((p) => p.id === id);
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
