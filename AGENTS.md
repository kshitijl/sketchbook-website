## Development philosophy (read this before making any change)

The owner is a grug-brain developer who hates pointless complexity and code bloat. This is a
standing preference for every change in this repo, not a one-off note:

- Before considering any edit done, self-review it against this: would the owner call this simple,
  or would they call it bloat?
- Prefer the boring, obvious, least-code solution over a clever or "more correct" one. Three
  similar lines beat a premature helper/abstraction.
- Don't add tests, defensive checks, abstractions, or "nice to have" infrastructure beyond what the
  task actually needs. This is a small personal site, not a platform — don't design or build for
  hypothetical future scale/requirements.
- If something already in the codebase looks like unrequested complexity, flag it rather than
  quietly building more on top of it. See `docs/TODO.md`'s "Standing priority: simplicity over
  cleverness" section for the running list and history of what's already been flagged/removed.
- When genuinely unsure whether something crosses the line, ask rather than guessing.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
