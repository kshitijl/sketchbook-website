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
| `npx wrangler dev`        | Run the built Worker under the real Workers runtime locally    |
