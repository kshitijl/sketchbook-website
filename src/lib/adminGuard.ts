/**
 * Defense-in-depth on top of Cloudflare Access, which is the actual gate on `/admin/*` (see
 * docs/architecture.md's Auth section) — this assumes Access is already blocking non-matching
 * requests at the edge before they ever reach the Worker. No-ops (always authorized) until
 * ADMIN_EMAIL is set as a real Worker var/secret (see docs/TODO.md), which is true for all of
 * local dev today, by design — there's no Access to check against locally.
 */
export function isAuthorizedAdminRequest(request: Request, env: { ADMIN_EMAIL?: string }): boolean {
	if (!env.ADMIN_EMAIL) return true;
	return request.headers.get('Cf-Access-Authenticated-User-Email') === env.ADMIN_EMAIL;
}
