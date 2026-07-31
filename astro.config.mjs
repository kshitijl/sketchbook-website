// @ts-check
import { execSync } from 'node:child_process';
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

// Baked in at build time and read by the debug footer — the Worker has no git and no build clock
// at runtime, so this is the only point where either is knowable. Since `npm run deploy` builds
// and deploys in one shot, what a *deployed* page reports is when that deploy happened. `--dirty`
// marks a build made with uncommitted changes, so the hash can't quietly misrepresent what's live.
// No try/catch: if git isn't available the build should fail loudly, not ship an "unknown" label.
const buildCommit = execSync('git describe --always --dirty --abbrev=7').toString().trim();
const buildTime = new Date().toISOString();

// https://astro.build/config
export default defineConfig({
  output: 'server',
  // 'passthrough' stops the adapter wiring up Cloudflare Images and injecting an IMAGES binding
  // into the generated deploy config. Nothing here uses astro:assets — every image is a plain
  // <img> pointing at a pre-generated R2 variant (see docs/architecture.md's Images section), and
  // the only bundled image imports (Leaflet's marker PNGs) use `?url` to skip the pipeline too.
  adapter: cloudflare({ imageService: 'passthrough' }),
  vite: {
    define: {
      __BUILD_COMMIT__: JSON.stringify(buildCommit),
      __BUILD_TIME__: JSON.stringify(buildTime)
    }
  }
});