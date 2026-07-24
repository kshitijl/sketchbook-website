import { describe, it, expect } from 'vitest';
import {
	getPieceById,
	getPrimaryAsset,
	orderAssetsFinalFirst,
	compareDatesDescending,
	getPiecesByTag,
	getAssetsByKind,
	getPiecesByDateDescending,
	getRandomPieces,
	getPiecesByPlace,
	getTagFrequency,
	isPainting,
	getPaintingStats,
	distanceMiles,
	getNearbyPieces,
	getTimelineNeighbors
} from './facets';
import type { Piece, PiecesData } from './types';

function makePiece(overrides: Partial<Piece> = {}): Piece {
	return {
		id: 'piece-1',
		title: 'Untitled',
		date: '2024-01-01',
		location: { lat: 0, lng: 0, placeName: 'Nowhere' },
		tags: [],
		notes: '',
		favoriteRank: null,
		assets: [],
		...overrides
	};
}

function makeData(pieces: Piece[]): PiecesData {
	return { pieces, pinnedLinks: [] };
}

describe('getPieceById', () => {
	it('finds a piece by id', () => {
		const a = makePiece({ id: 'a' });
		const b = makePiece({ id: 'b' });
		expect(getPieceById(makeData([a, b]), 'b')).toBe(b);
	});

	it('returns undefined for an unknown id', () => {
		expect(getPieceById(makeData([makePiece({ id: 'a' })]), 'nope')).toBeUndefined();
	});
});

describe('compareDatesDescending', () => {
	it('sorts newer dates before older ones', () => {
		expect(compareDatesDescending('2024-01-01', '2020-01-01')).toBeLessThan(0);
		expect(compareDatesDescending('2020-01-01', '2024-01-01')).toBeGreaterThan(0);
	});

	it('returns exactly 0 for equal dates — a comparator must be consistent regardless of which', () => {
		// argument order it's called with, or sorts of equal-date elements become unpredictable.
		expect(compareDatesDescending('2024-01-01', '2024-01-01')).toBe(0);
	});

	it('preserves original relative order for equal dates when used with a stable sort', () => {
		const items = [
			{ id: 'a', date: '2024-01-01' },
			{ id: 'b', date: '2024-06-01' },
			{ id: 'c', date: '2024-01-01' }
		];
		const sorted = [...items].sort((x, y) => compareDatesDescending(x.date, y.date));
		expect(sorted.map((i) => i.id)).toEqual(['b', 'a', 'c']);
	});
});

describe('getPrimaryAsset / orderAssetsFinalFirst', () => {
	it('prefers the final asset as primary, even if not first in the array', () => {
		const piece = makePiece({
			assets: [
				{ id: 'a1', kind: 'reference-photo', r2Key: 'r1', width: 0, height: 0, sizes: { thumb: 't', card: 'c', big: 'b' } },
				{ id: 'a2', kind: 'final', r2Key: 'r2', width: 0, height: 0, sizes: { thumb: 't', card: 'c', big: 'b' } }
			]
		});
		expect(getPrimaryAsset(piece)?.id).toBe('a2');
	});

	it('falls back to the first asset when there is no final', () => {
		const piece = makePiece({
			assets: [{ id: 'a1', kind: 'setup', r2Key: 'r1', width: 0, height: 0, sizes: { thumb: 't', card: 'c', big: 'b' } }]
		});
		expect(getPrimaryAsset(piece)?.id).toBe('a1');
	});

	it('returns undefined when there are no assets', () => {
		expect(getPrimaryAsset(makePiece())).toBeUndefined();
	});

	it('orders the final asset first without mutating the original array', () => {
		const original = [
			{ id: 'a1', kind: 'reference-photo' as const, r2Key: 'r1', width: 0, height: 0, sizes: { thumb: 't', card: 'c', big: 'b' } },
			{ id: 'a2', kind: 'final' as const, r2Key: 'r2', width: 0, height: 0, sizes: { thumb: 't', card: 'c', big: 'b' } }
		];
		const ordered = orderAssetsFinalFirst(original);
		expect(ordered.map((a) => a.id)).toEqual(['a2', 'a1']);
		expect(original.map((a) => a.id)).toEqual(['a1', 'a2']); // untouched
	});
});

describe('getPiecesByTag', () => {
	it('filters to pieces containing the tag, newest first', () => {
		const older = makePiece({ id: 'older', date: '2020-01-01', tags: ['india-2023'] });
		const newer = makePiece({ id: 'newer', date: '2023-01-01', tags: ['india-2023'] });
		const unrelated = makePiece({ id: 'unrelated', tags: ['providence'] });
		const result = getPiecesByTag(makeData([older, newer, unrelated]), 'india-2023');
		expect(result.map((p) => p.id)).toEqual(['newer', 'older']);
	});
});

describe('getAssetsByKind', () => {
	it('collects matching assets across pieces with their parent piece, newest first', () => {
		const p1 = makePiece({
			id: 'p1',
			date: '2020-01-01',
			assets: [{ id: 'a1', kind: 'setup', r2Key: 'r1', width: 0, height: 0, sizes: { thumb: 't', card: 'c', big: 'b' } }]
		});
		const p2 = makePiece({
			id: 'p2',
			date: '2023-01-01',
			assets: [{ id: 'a2', kind: 'setup', r2Key: 'r2', width: 0, height: 0, sizes: { thumb: 't', card: 'c', big: 'b' } }]
		});
		const result = getAssetsByKind(makeData([p1, p2]), 'setup');
		expect(result.map((r) => r.piece.id)).toEqual(['p2', 'p1']);
	});

	it('returns an empty array when nothing matches', () => {
		expect(getAssetsByKind(makeData([makePiece()]), 'value-study')).toEqual([]);
	});
});

describe('getPiecesByDateDescending', () => {
	it('sorts newest first without mutating the input', () => {
		const data = makeData([
			makePiece({ id: 'a', date: '2020-01-01' }),
			makePiece({ id: 'b', date: '2024-01-01' })
		]);
		const original = [...data.pieces];
		const sorted = getPiecesByDateDescending(data);
		expect(sorted.map((p) => p.id)).toEqual(['b', 'a']);
		expect(data.pieces).toEqual(original);
	});
});

describe('getRandomPieces', () => {
	it('never returns more than requested', () => {
		const pieces = Array.from({ length: 5 }, (_, i) => makePiece({ id: `p${i}` }));
		expect(getRandomPieces(pieces, 2)).toHaveLength(2);
	});

	it('returns everything available when fewer exist than requested', () => {
		const pieces = [makePiece({ id: 'only' })];
		expect(getRandomPieces(pieces, 10)).toHaveLength(1);
	});

	it('excludes ids in the exclude set', () => {
		const pieces = [makePiece({ id: 'a' }), makePiece({ id: 'b' }), makePiece({ id: 'c' })];
		const result = getRandomPieces(pieces, 10, new Set(['a', 'b']));
		expect(result.map((p) => p.id)).toEqual(['c']);
	});

	it('does not mutate the input array', () => {
		const pieces = Array.from({ length: 5 }, (_, i) => makePiece({ id: `p${i}` }));
		const copy = [...pieces];
		getRandomPieces(pieces, 3);
		expect(pieces).toEqual(copy);
	});
});

describe('getPiecesByPlace', () => {
	it('groups pieces by location.placeName', () => {
		const a = makePiece({ id: 'a', location: { lat: 0, lng: 0, placeName: 'Jaipur' } });
		const b = makePiece({ id: 'b', location: { lat: 0, lng: 0, placeName: 'Providence' } });
		const c = makePiece({ id: 'c', location: { lat: 0, lng: 0, placeName: 'Jaipur' } });
		const byPlace = getPiecesByPlace(makeData([a, b, c]));
		expect([...byPlace.keys()]).toEqual(['Jaipur', 'Providence']);
		expect(byPlace.get('Jaipur')?.map((p) => p.id)).toEqual(['a', 'c']);
	});
});

describe('getTagFrequency', () => {
	it('counts and sorts by frequency descending, ties broken alphabetically', () => {
		const data = makeData([
			makePiece({ tags: ['watercolor', 'india-2023'] }),
			makePiece({ tags: ['watercolor', 'ink'] }),
			makePiece({ tags: ['ink'] })
		]);
		const freq = getTagFrequency(data);
		expect(freq).toEqual([
			{ tag: 'ink', count: 2 },
			{ tag: 'watercolor', count: 2 },
			{ tag: 'india-2023', count: 1 }
		]);
	});
});

describe('isPainting', () => {
	it('counts a piece tagged "painting"', () => {
		expect(isPainting(makePiece({ tags: ['painting'] }))).toBe(true);
	});

	it('does not count a piece without the tag, regardless of medium', () => {
		expect(isPainting(makePiece({ tags: ['watercolor'] }))).toBe(false);
	});

	it('counts a piece with "painting" alongside other tags', () => {
		expect(isPainting(makePiece({ tags: ['ink', 'painting', 'watercolor'] }))).toBe(true);
	});
});

describe('distanceMiles', () => {
	it('is zero for identical points', () => {
		expect(distanceMiles({ lat: 40.7, lng: -74, placeName: '' }, { lat: 40.7, lng: -74, placeName: '' })).toBe(0);
	});

	it('roughly matches known distance between two cities (NYC to Philadelphia, ~80mi)', () => {
		const nyc = { lat: 40.7128, lng: -74.006, placeName: '' };
		const philly = { lat: 39.9526, lng: -75.1652, placeName: '' };
		expect(distanceMiles(nyc, philly)).toBeGreaterThan(75);
		expect(distanceMiles(nyc, philly)).toBeLessThan(85);
	});
});

describe('getNearbyPieces', () => {
	it('sorts by distance ascending and excludes the piece itself', () => {
		const origin = makePiece({ id: 'origin', location: { lat: 0, lng: 0, placeName: '' } });
		const near = makePiece({ id: 'near', location: { lat: 0.1, lng: 0, placeName: '' } });
		const far = makePiece({ id: 'far', location: { lat: 10, lng: 0, placeName: '' } });
		const result = getNearbyPieces([origin, near, far], origin, 10, 10000);
		expect(result.map((n) => n.piece.id)).toEqual(['near', 'far']);
	});

	it('caps at maxMiles even if fewer than maxCount pieces qualify', () => {
		const origin = makePiece({ id: 'origin', location: { lat: 0, lng: 0, placeName: '' } });
		const near = makePiece({ id: 'near', location: { lat: 0.1, lng: 0, placeName: '' } });
		const far = makePiece({ id: 'far', location: { lat: 10, lng: 0, placeName: '' } });
		const result = getNearbyPieces([origin, near, far], origin, 10, 50);
		expect(result.map((n) => n.piece.id)).toEqual(['near']);
	});

	it('caps at maxCount even if more pieces qualify within maxMiles', () => {
		const origin = makePiece({ id: 'origin', location: { lat: 0, lng: 0, placeName: '' } });
		const a = makePiece({ id: 'a', location: { lat: 0.1, lng: 0, placeName: '' } });
		const b = makePiece({ id: 'b', location: { lat: 0.2, lng: 0, placeName: '' } });
		const result = getNearbyPieces([origin, a, b], origin, 1, 10000);
		expect(result.map((n) => n.piece.id)).toEqual(['a']);
	});
});

describe('getTimelineNeighbors', () => {
	it('returns up to N chronological neighbors on each side', () => {
		const pieces = ['2020-01-01', '2021-01-01', '2022-01-01', '2023-01-01', '2024-01-01'].map((date, i) =>
			makePiece({ id: `p${i}`, date })
		);
		const result = getTimelineNeighbors(pieces, pieces[2], 3, 3);
		expect(result.before.map((p) => p.id)).toEqual(['p0', 'p1']);
		expect(result.after.map((p) => p.id)).toEqual(['p3', 'p4']);
	});

	it('truncates at the ends of the timeline instead of erroring', () => {
		const pieces = ['2020-01-01', '2021-01-01'].map((date, i) => makePiece({ id: `p${i}`, date }));
		const result = getTimelineNeighbors(pieces, pieces[0], 3, 3);
		expect(result.before).toEqual([]);
		expect(result.after.map((p) => p.id)).toEqual(['p1']);
	});
});

describe('getPaintingStats', () => {
	it('splits lifetime vs. this-year counts and computes the next-hundred milestone', () => {
		const now = new Date('2026-06-01T00:00:00Z');
		const data = makeData([
			makePiece({ id: 'old', date: '2020-01-01', tags: ['oil', 'painting'] }),
			makePiece({ id: 'this-year', date: '2026-02-01', tags: ['gouache', 'painting'] }),
			makePiece({ id: 'not-a-painting', date: '2026-03-01', tags: ['pencil'] })
		]);
		const stats = getPaintingStats(data, now);
		expect(stats.lifetimeCount).toBe(2);
		expect(stats.year).toBe(2026);
		expect(stats.yearCount).toBe(1);
		expect(stats.nextYearMilestone).toBe(100);
		expect(stats.remainingForYearMilestone).toBe(99);
	});

	it('rolls the milestone to the next hundred once the current one is reached', () => {
		const now = new Date('2026-01-01T00:00:00Z');
		const pieces = Array.from({ length: 100 }, (_, i) =>
			makePiece({ id: `p${i}`, date: '2026-01-01', tags: ['oil', 'painting'] })
		);
		const stats = getPaintingStats(makeData(pieces), now);
		expect(stats.yearCount).toBe(100);
		expect(stats.nextYearMilestone).toBe(200);
		expect(stats.remainingForYearMilestone).toBe(100);
	});
});
