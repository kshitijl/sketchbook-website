import type { PiecesData } from './types';

/**
 * On-write backup: called alongside every admin mutation, immediately, in the same request.
 * Cloudflare R2 has no native object/bucket versioning (still just a feature request, not a real
 * feature) — this is a second, separate bucket standing in for that. Deliberately best-effort:
 * a backup failure must never break the actual write it's shadowing, so callers should not let a
 * throw here surface as a user-facing error (though it should still show up in the visible log —
 * see logBackupEvent). See docs/architecture.md's Backups section.
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

/**
 * One entry per backup-relevant event — either an admin edit's on-write backup, or a daily
 * reconciliation run. This is the "here's the last 7-10 backup jobs" log the admin pages read, not
 * a single latest-status snapshot — so a specific run failing (or not running at all) is visible
 * in context, not just as one overwritten value.
 */
export type BackupLogEntry =
	| {
			kind: 'on-write';
			ranAt: string;
			action: string;
			pieceTitle?: string;
			imagesBackedUp: number;
			metadataSnapshotTaken: boolean;
			errors: string[];
	  }
	| {
			kind: 'reconciliation';
			ranAt: string;
			imagesChecked: number;
			imagesCopied: number;
			metadataSnapshotTaken: boolean;
			errors: string[];
	  };

export const BACKUP_LOG_PREFIX = 'backups/log/';
export const BACKUP_SNAPSHOTS_PREFIX = 'backups/pieces/';

/** Each entry is its own object under a unique key — never a read-modify-write of a shared list —
 * so concurrent log writes can't race or clobber each other, and, like the metadata snapshots,
 * every entry is kept forever (negligible cost at this size). */
export async function logBackupEvent(bucket: R2Bucket, entry: BackupLogEntry): Promise<void> {
	const key = `${BACKUP_LOG_PREFIX}${timestampForKey(new Date(entry.ranAt))}-${crypto.randomUUID().slice(0, 8)}.json`;
	await bucket.put(key, JSON.stringify(entry, null, 2), {
		httpMetadata: { contentType: 'application/json' }
	});
}

/** The most recent `limit` log entries, newest first. Paginates through the *entire* key listing
 * (not just R2's first 1000) so this stays correct once the total count grows past that in a
 * couple of years — keys are cheap to list (just strings), this only fetches the full bodies of
 * the ones actually returned. */
export async function getRecentBackupLog(bucket: R2Bucket, limit: number): Promise<BackupLogEntry[]> {
	const allKeys: string[] = [];
	let cursor: string | undefined;
	do {
		const listing = await bucket.list({ prefix: BACKUP_LOG_PREFIX, cursor, limit: 1000 });
		allKeys.push(...listing.objects.map((o) => o.key));
		cursor = listing.truncated ? listing.cursor : undefined;
	} while (cursor);

	const recentKeys = allKeys.sort().reverse().slice(0, limit);
	const entries: BackupLogEntry[] = [];
	for (const key of recentKeys) {
		const obj = await bucket.get(key);
		if (!obj) continue;
		try {
			entries.push(await obj.json());
		} catch {
			// Skip an unparseable entry rather than fail the whole log view over it.
		}
	}
	return entries;
}

/** Total count of every metadata snapshot ever taken — for the "N total snapshots kept" line. */
export async function countBackupSnapshots(bucket: R2Bucket): Promise<number> {
	let count = 0;
	let cursor: string | undefined;
	do {
		const listing = await bucket.list({ prefix: BACKUP_SNAPSHOTS_PREFIX, cursor, limit: 1000 });
		count += listing.objects.length;
		cursor = listing.truncated ? listing.cursor : undefined;
	} while (cursor);
	return count;
}
