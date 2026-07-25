# Changelog

## 0.1.0 (unreleased)

Initial release — increment 4 of NoHotfix CI reporters. Mirrors the shipped
`@nohotfix/playwright-reporter` / `@nohotfix/vitest-reporter` / `@nohotfix/cypress-reporter` over the
shared, unchanged `@nohotfix/ci-core`.

- Report Jest v29+ results into NoHotfix by tagging a test with its `ci_key` via `nhf.tag('<ci_key>')`
  (from `@nohotfix/jest-reporter/globals`); untagged tests are omitted, so you can migrate
  test-by-test. No title token is needed and the key moves with a title rename.
- Wire it with one line: `reporters: ['default', '@nohotfix/jest-reporter']`.
- Because Jest runs tests in worker processes and its `AssertionResult` carries no metadata, the tag
  bridges worker → reporter over a temp file keyed by the test's file + name (read from
  `expect.getState()`); tags are scoped by spec file, so same-named tests across files never collide.
  Requires the default `jest-circus` runner with `injectGlobals: true`. `test.concurrent` is
  supported (the tag uses Jest's concurrency-safe `currentConcurrentTestName`).
- Map Jest statuses through the shared status policy: `passed → passed`, `failed → failed`,
  `skipped`/`pending`/`todo`/`disabled` → `skipped`, and `focused`/any unknown status → `broken`
  (never silently `passed`).
- `reportedAt` is omitted — Jest exposes no per-test timestamp; `durationMs` is still reported.
- Auto-resolve the commit (GitHub / GitLab / CircleCI / Buildkite, or `NOHOTFIX_COMMIT`); never
  invents a commit.
- Resilient by default: unknown/archived `ci_key`, 5xx/network (retry then warn), and 429 never fail
  the build; only 401/403 (bad token) and 400 (malformed) fail clearly.
- Shard-safe content-addressed idempotency (`--shard=N/M` or `JEST_SHARD_INDEX`, under the stable
  `jest` reporter name); chunks submissions beyond the 2000-result cap.
- Per-test disposition to the console and the GitHub Actions step summary.
- Dry-run mode validates the credential (`GET /api/ci/ping`), prints the would-be payload, and
  submits nothing.
- Zero runtime dependencies (Node 20 built-in `fetch`/`crypto`); `jest` is a peer (`>=29.0.0`),
  `@nohotfix/ci-core` is bundled in.

> Stays at `0.x` until dogfooded against a live NoHotfix run, then `1.0.0`.
