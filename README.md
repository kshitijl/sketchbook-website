# 31-art-website

The code behind [klauria.art](https://klauria.art), a personal archive of my sketches and
paintings (Astro + Cloudflare Workers/R2). See `docs/architecture.md` for the design and
`docs/TODO.md` for the build history.

## How it works: dynamic for me, static for everyone else

Only one person can ever change anything on this site — me — and I do it every few days at most.
The site is built around that fact.

- **For me, it's a dynamic website.** I log in at `/admin` (behind Cloudflare Access) and upload,
  edit, retag and reorder pieces through ordinary forms. Changes go live immediately. There's no
  git commit, rebuild or redeploy to publish a painting.
- **For everyone else, it's a static website.** A page is rendered once, then sits in
  Cloudflare's edge cache for up to 30 days. Almost every visit is served straight from that
  cache, the Worker never runs, and nothing is read from storage. Images are pre-generated in
  three sizes when I upload them and served as immutable files, so nothing is ever resized on the
  fly.
- **Every edit I make clears the cache**, so the next visitor gets a freshly rendered page, which
  is then cached again. The cache doesn't expire on a timer; it's only cleared when something
  actually changes.

So it's a hybrid: dynamic where writes happen (rarely, by one person), static where reads happen
(constantly, by everyone). That's cheap for me, since it fits comfortably in Cloudflare's free and
low tiers, and it's efficient for Cloudflare, which is mostly serving cached bytes rather than
running code or hitting storage for each request.

## License

The **code** in this repository is MIT-licensed (see `LICENSE`). Use it however you like.

The **artwork** is not. All the sketches, paintings and photographs shown on klauria.art are my
own work, © Kshitij Lauria, all rights reserved. They aren't in this repository and aren't
covered by the MIT license, so please don't reuse them without asking.

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
