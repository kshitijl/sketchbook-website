#!/usr/bin/env node
// One-off backfill: generate the three pre-generated WebP display variants (thumb/card/big) for
// every asset that doesn't have them yet, and record the keys in data/pieces.json's `asset.sizes`.
//
// Context: the site no longer resizes on the fly (the Cloudflare Images binding is gone). Every
// image is served from a pre-generated variant object on R2. Images uploaded before this change
// have only a master (`r2Key`) and need their variants generated. New uploads generate variants in
// the browser; this script does the same for the existing collection, server-side, with `sharp`
// (libvips — same engine, so output matches the client path).
//
// Prereqs: an authenticated `wrangler` (same login used for deploys) and `sharp` (present via the
// dev toolchain). Run this BEFORE deploying the pre-generated-variants code — the still-deployed old
// code ignores `sizes`, so there's no broken window; then deploy. Safe to re-run: it skips any asset
// that already has all three `sizes`, and writes progress after each piece so a crash resumes.
//
// Usage: node scripts/backfill-image-variants.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const DATA_BUCKET = '31-art-website-data';
const BACKUP_BUCKET = '31-art-website-backups';
const DATA_KEY = 'data/pieces.json';
// Mirror of SIZE_WIDTHS in src/lib/images.ts (kept in sync by hand).
const SIZE_WIDTHS = { thumb: 240, card: 1000, big: 1800 };
const SIZES = ['thumb', 'card', 'big'];

const tmp = mkdtempSync(join(tmpdir(), 'art-variants-'));
const wrangler = (args) => execFileSync('npx', ['wrangler', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const r2Get = (bucket, key, file) => wrangler(['r2', 'object', 'get', `${bucket}/${key}`, '--remote', '--file', file]);
const r2Put = (bucket, key, file, ct) =>
	wrangler(['r2', 'object', 'put', `${bucket}/${key}`, '--remote', '--file', file, '--content-type', ct]);

// 1. Load current pieces.json.
const dataFile = join(tmp, 'pieces.json');
r2Get(DATA_BUCKET, DATA_KEY, dataFile);
const data = JSON.parse(readFileSync(dataFile, 'utf8'));

// 2. Snapshot it to the backup bucket before mutating the master metadata doc.
const snapKey = `backups/pieces/${new Date().toISOString().replace(/[:.]/g, '-')}-variants-backfill.json`;
r2Put(BACKUP_BUCKET, snapKey, dataFile, 'application/json');
console.log(`Snapshotted current pieces.json -> ${snapKey}\n`);

const hasAllSizes = (a) => a.sizes && SIZES.every((s) => a.sizes[s]);

// 3. For every asset missing variants, generate + upload thumb/card/big and set asset.sizes.
let done = 0;
let generated = 0;
const failures = [];
for (const piece of data.pieces) {
	let pieceChanged = false;
	for (const asset of piece.assets) {
		if (hasAllSizes(asset)) {
			done++;
			continue;
		}
		try {
			const origFile = join(tmp, 'orig');
			r2Get(DATA_BUCKET, asset.r2Key, origFile);
			const v = Date.now();
			const sizes = {};
			for (const size of SIZES) {
				const buf = await sharp(origFile)
					.rotate() // apply EXIF orientation (phone photos are often landscape + a rotate tag)
					.resize({ width: SIZE_WIDTHS[size], withoutEnlargement: true })
					.webp({ quality: 82 })
					.toBuffer();
				const outFile = join(tmp, `${size}.webp`);
				writeFileSync(outFile, buf);
				const key = `assets/${piece.id}/${asset.id}-${size}-v${v}.webp`;
				r2Put(DATA_BUCKET, key, outFile, 'image/webp');
				sizes[size] = key;
				generated++;
			}
			asset.sizes = sizes;
			pieceChanged = true;
			done++;
			console.log(`  ${piece.id}/${asset.id}: variants generated`);
		} catch (err) {
			failures.push(`${piece.id}/${asset.id} (${asset.r2Key}): ${String(err)}`);
			console.log(`  !! ${piece.id}/${asset.id}: FAILED — ${String(err)}`);
		}
	}
	// Write progress after each piece so a crash resumes rather than redoing everything.
	if (pieceChanged) {
		writeFileSync(dataFile, JSON.stringify(data));
		r2Put(DATA_BUCKET, DATA_KEY, dataFile, 'application/json');
	}
}

// 4. Verify the invariant: every asset must now have all three sizes.
const stillMissing = [];
for (const piece of data.pieces) {
	for (const asset of piece.assets) {
		if (!hasAllSizes(asset)) stillMissing.push(`${piece.id}/${asset.id}`);
	}
}

console.log(`\nAssets with variants: ${done}. Variant objects generated this run: ${generated}.`);
if (failures.length) console.log(`Failures (${failures.length}):\n  ${failures.join('\n  ')}`);
if (stillMissing.length) {
	console.log(`\nINCOMPLETE — ${stillMissing.length} asset(s) still missing variants. DO NOT DEPLOY until this is 0:`);
	console.log(`  ${stillMissing.join('\n  ')}`);
	rmSync(tmp, { recursive: true, force: true });
	process.exit(1);
}
console.log('\nAll assets have variants. Safe to deploy the pre-generated-variants code, then it just works.');
rmSync(tmp, { recursive: true, force: true });
