export type Stage = 'finished' | 'study';

export type AssetKind =
	| 'final'
	| 'reference-photo'
	| 'in-progress'
	| 'value-study'
	| 'setup';

export interface Asset {
	id: string;
	kind: AssetKind;
	r2Key: string;
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
	stage: Stage;
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
