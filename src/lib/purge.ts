/**
 * Best-effort cache purge after an admin write (see docs/architecture.md's cache policy — purge
 * on write, not TTL expiry). No-ops until CF_API_TOKEN/CF_ZONE_ID are set as real Worker secrets
 * (see docs/TODO.md) — written ahead of that setup so activating it needs no code changes, just
 * real secret values. A failure here is swallowed rather than surfaced: a missed purge self-heals
 * on the next write's purge call regardless of what that next write touches.
 */
export async function purgeEverything(env: { CF_API_TOKEN?: string; CF_ZONE_ID?: string }): Promise<void> {
	if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) return;
	try {
		await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${env.CF_API_TOKEN}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ purge_everything: true })
		});
	} catch {
		// Best-effort — see comment above.
	}
}
