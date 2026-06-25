# `@nohotfix/ci-core` (internal)

> **Not published.** This is a private workspace package, **bundled into each NoHotfix
> reporter** at build time (via tsup `noExternal`). Customers install only the reporter
> (e.g. `@nohotfix/playwright-reporter`); there is no public `ci-core` API to version.

It holds the ~70% of logic shared by every reporter:

- **status** — `mapStatus` (runner outcome → server enum; never silently `passed`)
- **commit** — `resolveCommit` (CI-provider priority; never invents a commit)
- **config** — `resolveConfig` (env > options, required-field validation)
- **idempotency** — `buildIdempotencyKey` (sha256, shard- and chunk-safe) + `chunk`
- **transport** — `submitResults` / `submitAll` (resilient-by-default; the warn-vs-fail matrix) + `ping`
- **summary** — `writeSummary` (console + GitHub step summary)

Zero non-builtin runtime dependencies (Node 20 `fetch`/`crypto`). `zod` is a test-only
devDependency used by the 056 contract test.
