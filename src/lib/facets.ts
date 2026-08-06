import type { Asset, AssetKind, Location, Piece, PiecesData } from './types';

export function getPieceById(data: PiecesData, id: string): Piece | undefined {
	return data.pieces.find((p) => p.id === id);
}

/** Newest-first comparator for ISO date strings ("YYYY-MM-DD"). Must return 0 on equal dates —
 * a comparator that always returns -1/1 for equal inputs is inconsistent and can sort equal-date
 * pieces unpredictably depending on the sort algorithm, which is exactly the bug this replaced. */
export function compareDatesDescending(a: string, b: string): number {
	if (a === b) return 0;
	return a < b ? 1 : -1;
}

/** The image to show as a piece's thumbnail/cover — the final piece if there is one, else
 * whatever's first. */
export function getPrimaryAsset(piece: Piece): Asset | undefined {
	return piece.assets.find((a) => a.kind === 'final') ?? piece.assets[0];
}

/** Final piece first, then everything else, so the main image always leads — used by both the
 * piece detail page and the map's inline detail panel. */
export function orderAssetsFinalFirst(assets: Asset[]): Asset[] {
	return [...assets].sort((a, b) => (a.kind === 'final' ? -1 : b.kind === 'final' ? 1 : 0));
}

export function getPiecesByTag(data: PiecesData, slug: string): Piece[] {
	return data.pieces
		.filter((p) => p.tags.includes(slug))
		.sort((a, b) => compareDatesDescending(a.date, b.date));
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
	return results.sort((a, b) => compareDatesDescending(a.piece.date, b.piece.date));
}

export function getPiecesByDateDescending(data: PiecesData): Piece[] {
	return [...data.pieces].sort((a, b) => compareDatesDescending(a.date, b.date));
}

/** A "rediscover something old" pick for the home page — random, not recent/favorite. */
export function getRandomPieces(pieces: Piece[], count: number, excludeIds: ReadonlySet<string> = new Set()): Piece[] {
	const pool = pieces.filter((p) => !excludeIds.has(p.id));
	const shuffled = [...pool];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled.slice(0, count);
}

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance between two lat/lng points, in miles. */
export function distanceMiles(a: Location, b: Location): number {
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLng = toRad(b.lng - a.lng);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

export interface NearbyPiece {
	piece: Piece;
	miles: number;
}

/** Other pieces closest to `piece`'s location, nearest first — capped at `maxCount` pieces and
 * `maxMiles` radius, whichever limit is hit first. The radius cap matters: without it, a piece
 * painted somewhere isolated would have its "nearby" list padded out with pieces hundreds of
 * miles away just to fill the count. */
export function getNearbyPieces(pieces: Piece[], piece: Piece, maxCount: number, maxMiles: number): NearbyPiece[] {
	return pieces
		.filter((p) => p.id !== piece.id)
		.map((p) => ({ piece: p, miles: distanceMiles(piece.location, p.location) }))
		.filter((n) => n.miles <= maxMiles)
		.sort((a, b) => a.miles - b.miles)
		.slice(0, maxCount);
}

export interface TimelineNeighbors {
	before: Piece[];
	after: Piece[];
}

/** Chronological neighbors of `piece` — up to `before` pieces immediately preceding it and
 * `after` immediately following, oldest first either side. Ties on the same date are broken by
 * id so the ordering is stable and deterministic. */
export function getTimelineNeighbors(pieces: Piece[], piece: Piece, before: number, after: number): TimelineNeighbors {
	const sorted = [...pieces].sort((a, b) => {
		if (a.date !== b.date) return a.date < b.date ? -1 : 1;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
	const idx = sorted.findIndex((p) => p.id === piece.id);
	if (idx === -1) return { before: [], after: [] };
	return {
		before: sorted.slice(Math.max(0, idx - before), idx),
		after: sorted.slice(idx + 1, idx + 1 + after)
	};
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

/** A "painting" is just whatever's tagged `painting` — the artist's own call, not a derived guess. */
export function isPainting(piece: Piece): boolean {
	return piece.tags.includes('painting');
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
	// getUTCFullYear(), not getFullYear(): piece.date is a plain "YYYY-MM-DD" string with no
	// timezone of its own, and Workers run in UTC — using local-time getFullYear() here made this
	// dependent on the executing environment's timezone (caught by a test run somewhere west of
	// UTC, where midnight UTC on Jan 1 is still "last year" locally).
	const year = now.getUTCFullYear();
	const paintings = data.pieces.filter(isPainting);
	const lifetimeCount = paintings.length;
	const yearCount = paintings.filter((p) => p.date.startsWith(String(year))).length;
	const nextYearMilestone = (Math.floor(yearCount / 100) + 1) * 100;
	const remainingForYearMilestone = nextYearMilestone - yearCount;
	return { lifetimeCount, year, yearCount, nextYearMilestone, remainingForYearMilestone };
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'];

/** '2026-06' → 'June 2026'. Shared by the home page's timeline/top-months and `/month/<month>`, so
 * the same month never gets spelled two different ways depending on where you're looking. */
export function monthLabel(month: string): string {
	const [year, m] = month.split('-');
	return `${MONTH_NAMES[Number(m) - 1]} ${year}`;
}

/** Every painting made in a 'YYYY-MM' month, newest first — the `/month/<month>` page behind each
 * row of the home page's top-months table. Paintings only, not every piece, so the page's contents
 * match the count in the table that linked to it. */
export function getPaintingsInMonth(data: PiecesData, month: string): Piece[] {
	return data.pieces
		.filter((piece) => isPainting(piece) && piece.date.startsWith(`${month}-`))
		.sort((a, b) => compareDatesDescending(a.date, b.date));
}

export interface PaintingMonth {
	month: string; // 'YYYY-MM'
	count: number;
	rank: number; // 1-based, across every month that has at least one painting
	isCurrent: boolean;
}

/**
 * The best months for painting, plus how this one is going: the top `top` months by paintings made,
 * with the current month appended at the end if it didn't make the cut — carrying its real rank, so
 * a bad month says "17th" rather than hiding. A current month with no paintings yet ranks below
 * every month that has any.
 *
 * UTC for the same reason `getPaintingStats()` uses it: `piece.date` is a bare 'YYYY-MM-DD' with no
 * timezone, and Workers run in UTC, so reading the current month in local time would make the
 * highlighted row depend on where the code happens to run.
 */
export function getTopPaintingMonths(data: PiecesData, now: Date, top = 5): PaintingMonth[] {
	const counts = new Map<string, number>();
	for (const piece of data.pieces) {
		if (!isPainting(piece)) continue;
		const month = piece.date.slice(0, 7);
		counts.set(month, (counts.get(month) ?? 0) + 1);
	}
	const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
	// Ties break most-recent-first, matching the newest-first ordering used everywhere else.
	const ranked = [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))
		.map(([month, count], i) => ({ month, count, rank: i + 1, isCurrent: month === currentMonth }));

	const rows = ranked.slice(0, top);
	if (!rows.some((row) => row.isCurrent)) {
		rows.push(
			ranked.find((row) => row.isCurrent) ?? { month: currentMonth, count: 0, rank: ranked.length + 1, isCurrent: true }
		);
	}
	return rows;
}
