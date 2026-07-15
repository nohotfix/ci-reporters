# Changelog

## 0.1.0 (unreleased)

Initial release — increment 2 of NoHotfix CI reporters. Mirrors the shipped
`@nohotfix/playwright-reporter` over the shared, unchanged `@nohotfix/ci-core`.

- Report Vitest v3 results into NoHotfix by tagging a test with its `ci_key` via
  `nhf.tag(ctx, '<ci_key>')` (or the raw `ctx.task.meta.nhfKey` metadata path); untagged tests
  are omitted, so you can migrate test-by-test.
- Map Vitest states through the shared status policy: `passed → passed`, `failed → failed`,
  `skipped`/`todo` → `skipped`, and any non-terminal/unknown state → `broken` (never silently
  `passed`); retries resolve to the final attempt.
- Auto-resolve the commit (GitHub / GitLab / CircleCI / Buildkite, or `NOHOTFIX_COMMIT`); never
  invents a commit.
- Resilient by default: unknown/archived `ci_key`, 5xx/network (retry then warn), and 429 never
  fail the build; only 401/403 (bad token) and 400 (malformed) fail clearly.
- Shard-safe content-addressed idempotency (`--shard=N/M` or `VITEST_SHARD_INDEX`, under the
  stable `vitest` reporter name); chunks submissions beyond the 2000-result cap.
- Per-test disposition to the console and the GitHub Actions step summary.
- Dry-run mode validates the credential (`GET /api/ci/ping`), prints the would-be payload, and
  submits nothing.
- Zero runtime dependencies (Node 20 built-in `fetch`/`crypto`); `vitest` is a peer (`>=3.0.0`),
  `@nohotfix/ci-core` is bundled in.

> Stays at `0.x` until dogfooded against a live NoHotfix run, then `1.0.0`.
