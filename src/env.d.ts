// Worker secrets (`wrangler secret put ...`), not `wrangler.jsonc` vars — `wrangler types` has no
// way to know about them from config alone, so they're declared here instead.
declare global {
	interface Env {
		ADMIN_EMAIL?: string;
		DEPLOY_PURGE_TOKEN?: string;
	}
	namespace Cloudflare {
		interface Env {
			ADMIN_EMAIL?: string;
			DEPLOY_PURGE_TOKEN?: string;
		}
	}
}

export {};
