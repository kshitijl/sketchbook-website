import type { PiecesData } from './types';

/**
 * On-write backup: called alongside every admin mutation, immediately, in the same request.
 * Cloudflare R2 has no native object/bucket versioning (still just a feature request, not a real
 * feature) — this is a second, separate bucket standing in for that. Deliberately best-effort:
 * a backup failure must never break the actual write it's shadowing, so callers should not let a
 * throw here surface as a user-facing error. See docs/architecture.md's Backups section.
 */

function timestampForKey(date: Date): string {
	// Filesystem/URL-safe: no colons. Still sorts correctly as a string since it's still ISO order.
	return date.toISOString().replace(/[:.]/g, '-');
}

/** Writes a timestamped, never-overwritten snapshot of the full metadata document. Every past
 * version is kept — at this document's size (a few hundred KB even at scale), keeping every
 * snapshot ever taken for years costs a rounding error in storage, so there's no pruning logic. */
export async function backupPieceData(bucket: R2Bucket, data: PiecesData, now: Date = new Date()): Promise<void> {
	const key = `backups/pieces/${timestampForKey(now)}.json`;
	await bucket.put(key, JSON.stringify(data, null, 2), {
		httpMetadata: { contentType: 'application/json' }
	});
}

/** Copies one just-uploaded asset's bytes into the backup bucket under the same key, so every
 * image is backed up the instant it's uploaded rather than waiting for the next reconciliation
 * run. `buffer` is passed in rather than re-read from the primary bucket since the caller already
 * has it in memory from the upload itself. */
export async function backupAsset(
	bucket: R2Bucket,
	r2Key: string,
	buffer: ArrayBuffer,
	contentType: string
): Promise<void> {
	await bucket.put(r2Key, buffer, { httpMetadata: { contentType } });
}

export interface BackupStatus {
	ranAt: string;
	imagesChecked: number;
	imagesCopied: number;
	metadataSnapshotTaken: boolean;
	errors: string[];
}

export const BACKUP_STATUS_KEY = 'backups/status.json';
export const BACKUP_SNAPSHOTS_PREFIX = 'backups/pieces/';
