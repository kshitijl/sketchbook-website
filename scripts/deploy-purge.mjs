#!/usr/bin/env node
/**
 * Runs right after `wrangler deploy` (see the `deploy` script in package.json) — a code-only
 * deploy doesn't otherwise purge the Workers Cache on its own (see docs/architecture.md's Cache
 * policy section for why that gap exists and why a short TTL isn't an acceptable fix for it).
 *
 * DEPLOY_PURGE_TOKEN never needs to be remembered or stored anywhere between deploys: it's a fresh
 * random value generated right here, set as the Worker secret via the `wrangler` login already
 * authenticated in this environment, used immediately to call /deploy-purge, and then forgotten.
 * There's nothing to persist and nothing that can go stale.
 *
 * By default this purges only pages (`Cache-Tag: page`), never the separately-cached, immutable
 * resized-image cache — a code deploy can only change what a page renders, never what a
 * previously-resized image looks like. Pass `--full` for the rare case a real hard reset is
 * needed (e.g. the tagging scheme in src/lib/cache.ts itself changes) — this is NOT part of the
 * normal `npm run deploy` chain, only ever run by hand.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const PURGE_URL = 'https://klauria.art/deploy-purge';
// Observed live: a secret rotation can occasionally take longer than 20s to fully propagate
// before the new token is recognized everywhere — 8 attempts × 5s covers that with margin.
const MAX_ATTEMPTS = Number(process.env.PURGE_MAX_ATTEMPTS) || 8;
const RETRY_DELAY_MS = 5000;
/**
 * Wait before purging, not after. `wrangler deploy` returns before the new Worker version has
 * reached every edge location, so a request arriving in that window is served by the *old* code —
 * and cached. Purging immediately therefore purges too early: it can't clear an entry that hasn't
 * been created yet, and the stale entry then sits there for the full 30-day `s-maxage`.
 *
 * Seen live 2026-08-06, which is why this exists: a deploy added the `/month/<YYYY-MM>` route, and
 * a request for one of those brand-new URLs landed on an edge still running the previous version
 * moments after the purge. It got the site's 404 page, that 404 got cached, and the URL kept
 * serving a cached 404 (`cf-cache-status: HIT`, previous deployment's build stamp in the footer)
 * for a page that existed. Purging by hand afterwards fixed it — this makes that automatic.
 */
const PROPAGATION_WAIT_MS = Number(process.env.PURGE_PROPAGATION_WAIT_MS) || 45000;
const full = process.argv.includes('--full');

const token = randomBytes(24).toString('hex');

console.log('Rotating DEPLOY_PURGE_TOKEN...');
execFileSync('npx', ['wrangler', 'secret', 'put', 'DEPLOY_PURGE_TOKEN'], {
	input: token,
	stdio: ['pipe', 'inherit', 'inherit']
});

console.log(`Waiting ${PROPAGATION_WAIT_MS / 1000}s for the new version to reach every edge...`);
await new Promise((resolve) => setTimeout(resolve, PROPAGATION_WAIT_MS));

// Setting a secret redeploys a new Worker version — like any deploy, it can take a few seconds to
// reach every edge location, so a purge call right after setting it may briefly still hit an
// older version that doesn't know the new token yet. Retry rather than fail outright on that.
console.log(full ? 'Purging cache (full)...' : 'Purging cache...');
const url = `${PURGE_URL}?token=${token}${full ? '&full=1' : ''}`;
let lastError = '';
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
	const res = await fetch(url);
	const body = await res.text();
	if (res.ok && (body === 'purged' || body === 'purged everything')) {
		console.log(`${body}.`);
		process.exit(0);
	}
	lastError = `${res.status} ${body}`;
	if (attempt < MAX_ATTEMPTS) {
		await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
	}
}

console.error(`Purge failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
process.exit(1);
