#!/usr/bin/env node
// One-off fix: the initial variant backfill used sharp without `.rotate()`, so it ignored EXIF
// orientation. Phone photos are often stored landscape with a "rotate 90°" EXIF tag; the old
// Cloudflare Images binding applied it automatically, sharp does not — so those variants came out
// sideways. This regenerates the three variants WITH `.rotate()` for every asset whose master
// actually has a non-trivial EXIF orientation, and repoints `asset.sizes` at the new keys.
//
// Only JPEG masters are checked (PNG has no EXIF orientation). Assets already correct (orientation
// 1 / none) are skipped. Old (sideways) variant objects are left in R2, dereferenced — harmless.
//
// Usage: node scripts/reorient-image-variants.mjs   (run before/after deploy; purge after)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

// The temp file is reused per asset; sharp caches metadata() by filename, so a naive
// sharp(path).metadata() returns the FIRST asset's orientation for all of them. Disable the cache
// and (belt-and-suspenders) read metadata from a Buffer below.
sharp.cache(false);

const DATA_BUCKET = '31-art-website-data';
const BACKUP_BUCKET = '31-art-website-backups';
const DATA_KEY = 'data/pieces.json';
const SIZE_WIDTHS = { thumb: 240, card: 1000, big: 1800 };
const SIZES = ['thumb', 'card', 'big'];

const tmp = mkdtempSync(join(tmpdir(), 'art-reorient-'));
const wrangler = (args) => execFileSync('npx', ['wrangler', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const r2Get = (bucket, key, file) => wrangler(['r2', 'object', 'get', `${bucket}/${key}`, '--remote', '--file', file]);
const r2Put = (bucket, key, file, ct) =>
	wrangler(['r2', 'object', 'put', `${bucket}/${key}`, '--remote', '--file', file, '--content-type', ct]);

const dataFile = join(tmp, 'pieces.json');
r2Get(DATA_BUCKET, DATA_KEY, dataFile);
const data = JSON.parse(readFileSync(dataFile, 'utf8'));

const snapKey = `backups/pieces/${new Date().toISOString().replace(/[:.]/g, '-')}-reorient.json`;
r2Put(BACKUP_BUCKET, snapKey, dataFile, 'application/json');
console.log(`Snapshotted current pieces.json -> ${snapKey}\n`);

let checked = 0;
let fixed = 0;
const failures = [];
for (const piece of data.pieces) {
	let pieceChanged = false;
	for (const asset of piece.assets) {
		if (!/\.jpe?g$/i.test(asset.r2Key)) continue; // only JPEGs carry EXIF orientation
		try {
			const origFile = join(tmp, 'orig');
			r2Get(DATA_BUCKET, asset.r2Key, origFile);
			checked++;
			const origBuf = readFileSync(origFile);
			const { orientation } = await sharp(origBuf).metadata();
			if (!orientation || orientation === 1) continue; // already upright

			const v = Date.now();
			const sizes = {};
			for (const size of SIZES) {
				const buf = await sharp(origBuf)
					.rotate() // apply the EXIF orientation
					.resize({ width: SIZE_WIDTHS[size], withoutEnlargement: true })
					.webp({ quality: 82 })
					.toBuffer();
				const outFile = join(tmp, `${size}.webp`);
				writeFileSync(outFile, buf);
				const key = `assets/${piece.id}/${asset.id}-${size}-v${v}.webp`;
				r2Put(DATA_BUCKET, key, outFile, 'image/webp');
				sizes[size] = key;
			}
			asset.sizes = sizes;
			pieceChanged = true;
			fixed++;
			console.log(`  ${piece.id}/${asset.id}: reoriented (EXIF orientation ${orientation})`);
		} catch (err) {
			failures.push(`${piece.id}/${asset.id}: ${String(err)}`);
			console.log(`  !! ${piece.id}/${asset.id}: FAILED — ${String(err)}`);
		}
	}
	if (pieceChanged) {
		writeFileSync(dataFile, JSON.stringify(data));
		r2Put(DATA_BUCKET, DATA_KEY, dataFile, 'application/json');
	}
}

console.log(`\nJPEG masters checked: ${checked}. Reoriented: ${fixed}.`);
if (failures.length) {
	console.log(`Failures (${failures.length}):\n  ${failures.join('\n  ')}`);
	rmSync(tmp, { recursive: true, force: true });
	process.exit(1);
}
console.log('Done. Purge the cache so pages re-render: node scripts/deploy-purge.mjs');
rmSync(tmp, { recursive: true, force: true });
