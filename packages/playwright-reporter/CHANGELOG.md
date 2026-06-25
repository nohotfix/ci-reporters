# Changelog

## 0.1.0 (unreleased)

Initial release — increment 1 of NoHotfix CI reporters.

- Report Playwright results into NoHotfix via a structured `{ type: 'nhf', description: '<ci_key>' }`
  annotation (config-level or runtime-push); tests without the annotation are omitted.
- Auto-resolve the commit (GitHub / GitLab / CircleCI / Buildkite, or `NOHOTFIX_COMMIT`); never
  invents a commit.
- Resilient by default: unknown/archived `ci_key`, 5xx/network (retry then warn), and 429 never
  fail the build; only 401/403 (bad token) and 400 (malformed) fail clearly.
- Shard-safe content-addressed idempotency; chunks submissions beyond the 2000-result cap.
- Per-test disposition to the console and the GitHub Actions step summary.
- Dry-run mode validates the credential (`GET /api/ci/ping`), prints the would-be payload, and
  submits nothing.
- Zero runtime dependencies (Node 20 built-in `fetch`/`crypto`); `@playwright/test` is a peer (`>=1.40`).

> Stays at `0.x` until dogfooded against a live NoHotfix run, then `1.0.0`.
