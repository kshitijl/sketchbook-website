// Worker secrets (`wrangler secret put ...`), not `wrangler.jsonc` vars — `wrangler types` has no
// way to know about them from config alone, so they're declared here instead. IMAGES is a real
// binding too, just one the @astrojs/cloudflare adapter injects automatically into the generated
// deploy config rather than something declared in this project's own wrangler.jsonc — `wrangler
// types` only reads the latter, so it doesn't know about this binding either. `ImagesBinding` is
// already declared ambiently by the Cloudflare Workers types (see worker-configuration.d.ts).
declare global {
	interface Env {
		ADMIN_EMAIL?: string;
		DEPLOY_PURGE_TOKEN?: string;
		IMAGES: ImagesBinding;
	}
	namespace Cloudflare {
		interface Env {
			ADMIN_EMAIL?: string;
			DEPLOY_PURGE_TOKEN?: string;
			IMAGES: ImagesBinding;
		}
	}
}

export {};
