# Changelog

## 0.1.0 (unreleased)

Initial release — increment 3 of NoHotfix CI reporters. Mirrors the shipped
`@nohotfix/playwright-reporter` / `@nohotfix/vitest-reporter` over the shared, unchanged
`@nohotfix/ci-core`.

- Report Cypress v13+ results into NoHotfix by tagging a test with its `ci_key` via
  `nhf.tag('<ci_key>')` (from `@nohotfix/cypress-reporter/support`); untagged tests are omitted, so
  you can migrate test-by-test. The tag bridges browser → Node over a reserved `cy.task`, so no
  title token is needed and the key moves with a title rename. Tags are scoped by spec file
  (`Cypress.spec.relative`), so two tests that share a title path across different specs never
  collide in the single run-wide plugin process.
- `reportedAt` is intentionally omitted: Cypress's `after:run` payload exposes no per-test
  timestamp, and the reporter never emits a value at a precision the runner didn't give it
  (`durationMs`, the real top-level field, is still sent). Playwright/Vitest still emit `reportedAt`.
- If Cypress fails to run at all (no specs matched / a fatal setup error), the reporter warns and
  submits nothing rather than masking it as "no tagged tests" — and still never red-fails.
- Wire it with one line in `setupNodeEvents`: `setupNoHotfix(on, config)` registers the tag task
  and the `after:run` submit hook.
- Map Cypress states through the shared status policy: `passed → passed`, `failed → failed`,
  `pending` (intentional skip) → `skipped`, `skipped` (aborted by a hook failure) → `broken`, and
  any unknown/non-terminal state → `broken` (never silently `passed`); the final resolved state of
  a retried test is reported.
- Auto-resolve the commit (GitHub / GitLab / CircleCI / Buildkite, or `NOHOTFIX_COMMIT`); never
  invents a commit.
- Resilient by default: unknown/archived `ci_key`, 5xx/network (retry then warn), and 429 never
  fail the build; only 401/403 (bad token) and 400 (malformed) fail clearly.
- Shard-safe content-addressed idempotency (`CYPRESS_SHARD_INDEX`, under the stable `cypress`
  reporter name); chunks submissions beyond the 2000-result cap.
- Per-test disposition to the console and the GitHub Actions step summary.
- Dry-run mode validates the credential (`GET /api/ci/ping`), prints the would-be payload, and
  submits nothing.
- Zero runtime dependencies (Node 20 built-in `fetch`/`crypto`); `cypress` is a peer (`>=13.0.0`),
  `@nohotfix/ci-core` is bundled in.

> Stays at `0.x` until dogfooded against a live NoHotfix run, then `1.0.0`.
