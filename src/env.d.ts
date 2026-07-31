// Worker secrets (`wrangler secret put ...`), not `wrangler.jsonc` vars — `wrangler types` has no
// way to know about them from config alone, so they're declared here instead.
declare global {
	// Build-time constants substituted by Vite's `define` (see astro.config.mjs), not runtime
	// values. These must live inside `declare global`: this file is a module (it has an `export`),
	// so a top-level `declare const` would only be visible within the file itself.
	const __BUILD_COMMIT__: string;
	const __BUILD_TIME__: string;

	interface Env {
		DEPLOY_PURGE_TOKEN?: string;
	}
	namespace Cloudflare {
		interface Env {
			DEPLOY_PURGE_TOKEN?: string;
		}
	}
}

export {};
