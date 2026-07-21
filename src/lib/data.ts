import { EMPTY_PIECES_DATA, type PiecesData } from './types';

const PIECES_KEY = 'data/pieces.json';

export interface PiecesSnapshot {
	data: PiecesData;
	etag: string | null;
}

export class ConflictError extends Error {
	constructor() {
		super('data/pieces.json was modified concurrently; reload and retry');
		this.name = 'ConflictError';
	}
}

/** Reads the single metadata document. Returns an empty document (etag null) if it doesn't exist yet. */
export async function getPieces(bucket: R2Bucket): Promise<PiecesSnapshot> {
	const object = await bucket.get(PIECES_KEY);
	if (!object) {
		return { data: structuredClone(EMPTY_PIECES_DATA), etag: null };
	}
	const data = (await object.json()) as PiecesData;
	return { data, etag: object.httpEtag };
}

/**
 * Writes the metadata document back with an optimistic-concurrency check: if `expectedEtag` no
 * longer matches what's in R2 (someone/something else wrote in between), this throws
 * ConflictError instead of silently clobbering the other write. Caller should re-read and retry.
 */
export async function savePieces(
	bucket: R2Bucket,
	data: PiecesData,
	expectedEtag: string | null
): Promise<{ etag: string }> {
	const body = JSON.stringify(data, null, 2);
	const putOptions: R2PutOptions = {
		httpMetadata: { contentType: 'application/json' }
	};
	if (expectedEtag) {
		putOptions.onlyIf = { etagMatches: expectedEtag };
	}
	const result = await bucket.put(PIECES_KEY, body, putOptions);
	if (!result) {
		throw new ConflictError();
	}
	return { etag: result.httpEtag };
}
