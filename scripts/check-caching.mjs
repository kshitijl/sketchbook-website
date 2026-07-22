#!/usr/bin/env node
/**
 * Manual post-deploy caching smoke test — NOT part of `npm test` / CI. It depends on real
 * Cloudflare edge behavior (a Cache Rule, the CF-Cache-Status header) that simply doesn't exist
 * under local dev, so it only means something run against the live deployed site. See the
 * "Automated caching-behavior check" entry in docs/TODO.md for the full design rationale.
 *
 * Usage: node scripts/check-caching.mjs https://klauria.art
 *
 * For each path, fetches it twice back to back and asserts, on the *second* response:
 *   - CF-Cache-Status is HIT (not MISS/EXPIRED/DYNAMIC/BYPASS)
 *   - its data-render-id (the debug footer's crypto.randomUUID(), see src/layouts/Base.astro)
 *     is identical to the first response's
 *   - its body is byte-for-byte identical to the first response's
 * Any of those failing means the request re-rendered instead of being served from cache.
 */

const baseUrl = process.argv[2];
if (!baseUrl) {
	console.error('Usage: node scripts/check-caching.mjs <base-url>');
	console.error('Example: node scripts/check-caching.mjs https://klauria.art');
	process.exit(1);
}

const PATHS_TO_CHECK = ['/', '/kind/setup'];

function extractRenderId(html) {
	const match = html.match(/data-render-id="([^"]+)"/);
	return match ? match[1] : null;
}

async function checkPath(path) {
	const url = new URL(path, baseUrl).toString();
	const first = await fetch(url);
	const firstBody = await first.text();

	const second = await fetch(url);
	const secondBody = await second.text();

	const cacheStatus = second.headers.get('cf-cache-status');
	const firstRenderId = extractRenderId(firstBody);
	const secondRenderId = extractRenderId(secondBody);

	const problems = [];
	if (cacheStatus !== 'HIT') {
		problems.push(`CF-Cache-Status was "${cacheStatus ?? '(missing)'}", expected "HIT"`);
	}
	if (!firstRenderId || !secondRenderId) {
		problems.push('could not find data-render-id in one or both responses');
	} else if (firstRenderId !== secondRenderId) {
		problems.push(`render id changed (${firstRenderId} -> ${secondRenderId}) — page was re-rendered`);
	}
	if (firstBody !== secondBody) {
		problems.push('response bodies were not byte-identical');
	}

	return { path, url, ok: problems.length === 0, problems };
}

const results = [];
for (const path of PATHS_TO_CHECK) {
	results.push(await checkPath(path));
}

let anyFailed = false;
for (const result of results) {
	if (result.ok) {
		console.log(`PASS  ${result.path}`);
	} else {
		anyFailed = true;
		console.log(`FAIL  ${result.path}`);
		for (const problem of result.problems) {
			console.log(`      - ${problem}`);
		}
	}
}

process.exit(anyFailed ? 1 : 0);
