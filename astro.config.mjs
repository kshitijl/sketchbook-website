// @ts-check
import { execSync } from 'node:child_process';
import { defineConfig, sessionDrivers } from 'astro/config';

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
  // Nothing here uses Astro.session, but the adapter force-enables KV-backed sessions unless a
  // driver is set, injecting a SESSION KV namespace binding nothing reads. The `null` driver is the
  // one that says what's true — sessions go nowhere because nothing uses them — and it's the only
  // choice that adds no code to the Worker: every real driver gets bundled into it, so asking for
  // `lruCache` here would ship 25KB of LRU cache to store sessions that are never written.
  // @ts-expect-error `null` and `memory` exist in `sessionDrivers` at runtime but are missing from
  // Astro 7.1.3's .d.ts (only drivers taking an options type are declared). The alternative — the
  // plain `driver: 'memory'` string — is deprecated and warns on every build.
  session: { driver: sessionDrivers.null() },
  vite: {
    define: {
      __BUILD_COMMIT__: JSON.stringify(buildCommit),
      __BUILD_TIME__: JSON.stringify(buildTime)
    }
  }
});