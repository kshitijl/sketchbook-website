import { describe, it, expect } from 'vitest';
import { getPieces, savePieces, updatePieces, ConflictError } from './data';
import { EMPTY_PIECES_DATA } from './types';
import type { Piece, PiecesData } from './types';

function makePiece(id: string): Piece {
	return {
		id,
		title: 'Untitled',
		date: '2024-01-01',
		location: { lat: 0, lng: 0, placeName: 'Nowhere' },
		tags: [],
		notes: '',
		favoriteRank: null,
		assets: []
	};
}

/** Single place this file builds a PiecesData, so the document's shape can change without
 * touching every test. */
function makeData(pieces: Piece[] = []): PiecesData {
	return { pieces, pinnedLinks: [] };
}

/**
 * Minimal in-memory stand-in for R2Bucket, covering only what src/lib/data.ts actually uses:
 * get() and put() with the conditional onlyIf.etagMatches check. Mirrors real R2 semantics that
 * matter here: .etag is the unquoted form used for conditional checks (this distinction is
 * exactly what the real ETag bug — see git history — was about), and put() returns null rather
 * than throwing when the condition fails.
 */
class MockR2Bucket {
	private stored: { body: string; etag: string } | undefined;
	private counter = 0;

	/** Test hook: if set, runs synchronously on the *next* get() call, immediately after that
	 * call snapshots the current state to return — simulating a concurrent writer landing right
	 * after a read. Deliberately synchronous (no promises/timers involved) so tests don't depend
	 * on microtask ordering. */
	concurrentWriteOnNextGet: (() => void) | undefined;

	async get(_key: string) {
		const snapshot = this.stored;
		if (this.concurrentWriteOnNextGet) {
			const hook = this.concurrentWriteOnNextGet;
			hook();
		}
		if (!snapshot) return null;
		return {
			etag: snapshot.etag,
			httpEtag: `"${snapshot.etag}"`,
			json: async () => JSON.parse(snapshot.body)
		};
	}

	async put(_key: string, value: string, options?: { onlyIf?: { etagMatches?: string } }) {
		if (options?.onlyIf?.etagMatches !== undefined) {
			const current = this.stored?.etag;
			if (current !== options.onlyIf.etagMatches) {
				return null; // R2's real behavior: conditional failure returns null, doesn't throw
			}
		}
		this.counter += 1;
		const etag = `etag-${this.counter}`;
		this.stored = { body: value, etag };
		return { etag, httpEtag: `"${etag}"` };
	}

	/** Test-only direct write, bypassing the conditional check — for seeding/simulating writes
	 * from "someone else" without going through the module under test. */
	forceWrite(data: PiecesData): void {
		this.counter += 1;
		this.stored = { body: JSON.stringify(data), etag: `etag-${this.counter}` };
	}
}

function bucket() {
	return new MockR2Bucket();
}
function asR2(b: MockR2Bucket) {
	return b as unknown as Parameters<typeof getPieces>[0];
}

describe('getPieces', () => {
	it('returns the empty document with a null etag when nothing has been written yet', async () => {
		const { data, etag } = await getPieces(asR2(bucket()));
		expect(data).toEqual(EMPTY_PIECES_DATA);
		expect(etag).toBeNull();
	});

	it('returns the stored document and its etag after a write', async () => {
		const b = bucket();
		const doc = makeData([makePiece('piece-1')]);
		await savePieces(asR2(b), doc, null);
		const { data, etag } = await getPieces(asR2(b));
		expect(data).toEqual(doc);
		expect(etag).not.toBeNull();
	});
});

describe('savePieces', () => {
	it('writes unconditionally when expectedEtag is null (first write)', async () => {
		const result = await savePieces(asR2(bucket()), makeData(), null);
		expect(result.etag).toBeTruthy();
	});

	it('succeeds when expectedEtag matches the current stored etag', async () => {
		const b = bucket();
		const first = await savePieces(asR2(b), makeData(), null);
		const second = await savePieces(asR2(b), makeData(), first.etag);
		expect(second.etag).toBeTruthy();
	});

	it('throws ConflictError when expectedEtag is stale', async () => {
		const b = bucket();
		const first = await savePieces(asR2(b), makeData(), null);
		b.forceWrite(makeData()); // someone else writes in between
		await expect(
			savePieces(asR2(b), makeData(), first.etag)
		).rejects.toThrow(ConflictError);
	});
});

describe('updatePieces', () => {
	it('reads, applies the mutation, and writes back', async () => {
		const b = bucket();
		await updatePieces(asR2(b), (data) => {
			data.pieces.push(makePiece('added'));
		});
		const { data } = await getPieces(asR2(b));
		expect(data.pieces.map((p) => p.id)).toEqual(['added']);
	});

	it('retries exactly once on a single concurrent write, re-reading fresh data first', async () => {
		const b = bucket();
		b.forceWrite(makeData([makePiece('existing')]));

		// The moment updatePieces does its (first) read, simulate one concurrent writer landing —
		// so its first conditional put attempt is guaranteed to fail on a stale etag.
		b.concurrentWriteOnNextGet = () => {
			b.concurrentWriteOnNextGet = undefined; // exactly once
			b.forceWrite(makeData([makePiece('existing'), makePiece('concurrent')]));
		};

		await updatePieces(asR2(b), (data) => {
			data.pieces.push(makePiece('mine'));
		});

		const { data } = await getPieces(asR2(b));
		// All three must survive: the retry's re-read sees "concurrent" already there and adds
		// "mine" on top of it, rather than clobbering it with a stale copy.
		expect(data.pieces.map((p) => p.id).sort()).toEqual(['concurrent', 'existing', 'mine']);
	});

	it('gives up and throws ConflictError after exhausting retry attempts', async () => {
		const b = bucket();
		b.forceWrite(makeData());

		// Re-arms itself every time, so *every* attempt's conditional put is doomed to fail —
		// this can never succeed no matter how many attempts are allowed.
		const rearm = () => {
			b.forceWrite(makeData());
			b.concurrentWriteOnNextGet = rearm;
		};
		b.concurrentWriteOnNextGet = rearm;

		await expect(updatePieces(asR2(b), () => {}, 2)).rejects.toThrow(ConflictError);
	});
});
