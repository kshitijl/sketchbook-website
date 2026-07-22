/**
 * Standalone daily backup-reconciliation Worker for 31-art-website. Deliberately its own small,
 * plain (no Astro) Worker rather than bolted onto the main site's build — a Cron Trigger handler
 * coexisting with Astro's own request handler in one Worker is possible but a newer, less-traveled
 * integration path; this is boring and hard to break instead. See docs/architecture.md's Backups
 * section for the full design rationale.
 *
 * What it does, once a day:
 *  1. Reads the current metadata document from the main site's bucket.
 *  2. For every asset it references, makes sure a copy exists in the backup bucket — this is a
 *     self-healing safety net for the on-write backup in the main app (src/lib/backup.ts), which
 *     already copies each image the instant it's uploaded; this catches anything that path missed.
 *  3. Takes a redundant timestamped metadata snapshot (belt-and-suspenders vs. the on-write one).
 *  4. Writes a status report the main site's /admin/backups page reads and displays.
 */

interface Env {
	ART_BUCKET: R2Bucket;
	BACKUP_BUCKET: R2Bucket;
}

interface Asset {
	r2Key: string;
}
interface Piece {
	assets: Asset[];
}
interface PiecesData {
	pieces: Piece[];
}

const PIECES_KEY = 'data/pieces.json';
const STATUS_KEY = 'backups/status.json';

function timestampForKey(date: Date): string {
	return date.toISOString().replace(/[:.]/g, '-');
}

interface BackupStatus {
	ranAt: string;
	imagesChecked: number;
	imagesCopied: number;
	metadataSnapshotTaken: boolean;
	errors: string[];
}

async function runBackupCheck(env: Env): Promise<BackupStatus> {
	const ranAt = new Date().toISOString();
	const errors: string[] = [];
	let imagesChecked = 0;
	let imagesCopied = 0;
	let metadataSnapshotTaken = false;

	const piecesObj = await env.ART_BUCKET.get(PIECES_KEY);
	let data: PiecesData = { pieces: [] };

	if (!piecesObj) {
		errors.push(`${PIECES_KEY} not found in ART_BUCKET — nothing uploaded yet, or something's wrong`);
	} else {
		try {
			data = await piecesObj.json();
		} catch (err) {
			errors.push(`Failed to parse ${PIECES_KEY}: ${String(err)}`);
		}

		try {
			const snapshotKey = `backups/pieces/${timestampForKey(new Date(ranAt))}.json`;
			await env.BACKUP_BUCKET.put(snapshotKey, JSON.stringify(data, null, 2), {
				httpMetadata: { contentType: 'application/json' }
			});
			metadataSnapshotTaken = true;
		} catch (err) {
			errors.push(`Failed to write metadata snapshot: ${String(err)}`);
		}
	}

	for (const piece of data.pieces) {
		for (const asset of piece.assets) {
			imagesChecked++;
			try {
				const alreadyBackedUp = await env.BACKUP_BUCKET.head(asset.r2Key);
				if (alreadyBackedUp) continue;

				const original = await env.ART_BUCKET.get(asset.r2Key);
				if (!original) {
					errors.push(`Referenced but missing in ART_BUCKET: ${asset.r2Key}`);
					continue;
				}
				await env.BACKUP_BUCKET.put(asset.r2Key, original.body, {
					httpMetadata: original.httpMetadata
				});
				imagesCopied++;
			} catch (err) {
				errors.push(`Failed to check/copy ${asset.r2Key}: ${String(err)}`);
			}
		}
	}

	const status: BackupStatus = { ranAt, imagesChecked, imagesCopied, metadataSnapshotTaken, errors };
	await env.BACKUP_BUCKET.put(STATUS_KEY, JSON.stringify(status, null, 2), {
		httpMetadata: { contentType: 'application/json' }
	});
	return status;
}

export default {
	async scheduled(_event, env, ctx) {
		ctx.waitUntil(runBackupCheck(env));
	},
	// No public route is configured for this Worker (workers_dev: false, no custom domain), so
	// there's no real endpoint here for anyone else to reach — this exists so the reconciliation
	// logic can be manually re-run/verified (via `wrangler dev --remote` or the dashboard) without
	// waiting for the next scheduled tick, not as a general-purpose API.
	async fetch(_request, env) {
		const status = await runBackupCheck(env);
		return new Response(JSON.stringify(status, null, 2), {
			headers: { 'Content-Type': 'application/json' }
		});
	}
} satisfies ExportedHandler<Env>;
