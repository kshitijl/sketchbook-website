# 31-art-website

A personal art archive site (Astro + Cloudflare Workers/R2). See `docs/architecture.md` for the
design and `docs/TODO.md` for the build plan.

## Commands

| Command                 | Action                                                       |
| :----------------------- | :------------------------------------------------------------ |
| `npm install`             | Install dependencies                                           |
| `npm run dev`             | Start local dev server at `localhost:4321`                     |
| `npm run build`           | Build the production Worker to `./dist/`                       |
| `npm run generate-types`  | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc`    |
| `npm test`                | Run the unit test suite (Vitest)                                |
| `npx wrangler dev`        | Run the built Worker under the real Workers runtime locally    |
| `node scripts/check-caching.mjs <url>` | Post-deploy caching smoke test — see docs/TODO.md |

## Backups

`backup-worker/` is a separate small Cloudflare Worker (its own `wrangler.jsonc`) that runs the
daily backup reconciliation job — see docs/architecture.md's Backups section. It's independent of
the main site's build; deploy/test it from within that directory, always with an explicit config
flag (its own directory doesn't have a `.wrangler/` yet, so wrangler's auto-detection can pick up
the main project's stale build-redirect config otherwise):

```sh
cd backup-worker
npx wrangler types                              # regenerate types after a wrangler.jsonc change
npx tsc --noEmit                                # typecheck
npx wrangler deploy --config ./wrangler.jsonc   # deploy
npx wrangler dev --remote --config ./wrangler.jsonc   # run against real prod buckets to verify
```
