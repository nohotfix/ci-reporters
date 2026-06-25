# `@nohotfix/playwright-reporter`

Report your Playwright results into [NoHotfix](https://nohotfix.com) so they drive the
run's Go/No-Go gate — **no curl step, no JUnit file, no `[nhf:key]` title token**. Install
one package, add one line to your config, set two CI secrets, and annotate each automated
test with its NoHotfix `ci_key`.

> **It never breaks your build.** NoHotfix being down, a renamed `ci_key`, or a transient
> network error will only ever print a warning — your test job stays green. It fails clearly
> *only* on a bad token (401/403) or a malformed payload (400), which are real setup errors.

## 1. Install

```bash
npm install -D @nohotfix/playwright-reporter
```

## 2. Add the reporter

```ts
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['html'], // keep your existing reporters
    ['@nohotfix/playwright-reporter'], // ← the whole integration
  ],
});
```

## 3. Set two CI secrets

| Secret | Value |
|---|---|
| `NOHOTFIX_INGEST_TOKEN` | from NoHotfix → Settings → Integrations |
| `NOHOTFIX_ENVIRONMENT` | e.g. `production` or `staging` |

```yaml
# .github/workflows/ci.yml — the commit is auto-resolved from GITHUB_SHA
- run: npx playwright test
  env:
    NOHOTFIX_INGEST_TOKEN: ${{ secrets.NOHOTFIX_INGEST_TOKEN }}
    NOHOTFIX_ENVIRONMENT: production
```

## 4. Annotate each automated test

```ts
test(
  'checkout completes for a new user',
  { annotation: { type: 'nhf', description: 'checkout.new-user.complete' } },
  async ({ page }) => {
    /* unchanged */
  },
);
```

`description` is the test's `ci_key` from your NoHotfix library. A test with **no** `nhf`
annotation is omitted — migrate test-by-test. The binding survives title/describe/file changes.

You can also push it at runtime:

```ts
test.info().annotations.push({ type: 'nhf', description: 'checkout.new-user.complete' });
```

## Validate without touching the gate (dry-run)

```bash
NOHOTFIX_INGEST_TOKEN=nhf_xxx NOHOTFIX_ENVIRONMENT=production \
  NOHOTFIX_DRY_RUN=true npx playwright test
# Validates the token via GET /api/ci/ping, prints what WOULD be sent, POSTs nothing.
```

## Sharded / matrix runs

```yaml
- run: npx playwright test --shard=${{ matrix.shard }}/${{ matrix.total }}
  env:
    NOHOTFIX_INGEST_TOKEN: ${{ secrets.NOHOTFIX_INGEST_TOKEN }}
    NOHOTFIX_ENVIRONMENT: production
```

Each shard submits independently; NoHotfix fans them in. Re-running a shard is a no-op.

## Configuration

All options can be set via env var (preferred — they take priority) or the reporter options
object.

| Env var | Option | Required | Meaning |
|---|---|---|---|
| `NOHOTFIX_INGEST_TOKEN` | `token` | **yes** | org-scoped ingest token |
| `NOHOTFIX_ENVIRONMENT` | `environment` | **yes** | the run's environment |
| `NOHOTFIX_API_URL` | `apiUrl` | no | self-hosted override (default `https://api.nohotfix.com`) |
| `NOHOTFIX_COMMIT` | `commit` | no | override; else auto-resolved from CI |
| `NOHOTFIX_DRY_RUN` | `dryRun` | no | validate + print, submit nothing |
| `PLAYWRIGHT_SHARD_INDEX` | — | no | shard identity (else parsed from `--shard`) |

## What you'll see

```
[NoHotfix] Submitted 14 result(s) to https://api.nohotfix.com — 12 accepted, 2 ignored.
[NoHotfix]   ✓ checkout.new-user.complete  passed  842ms
[NoHotfix]   ↷ billing.retry  failed  120ms  (archived_test)
```

In GitHub Actions the same disposition is written to the job's step summary.

## Migrating off the older paths

This reporter supersedes the raw JUnit-token POST and the
[`nohotfix/report-results`](https://github.com/nohotfix/report-results) GitHub Action — but
both remain a permanent, universal fallback. You can adopt the reporter **test-by-test** and
remove the `[nhf:ci_key]` title tokens and the Action step once every automated test carries
an `nhf` annotation. Nothing server-side changes.

## Requirements

- Node.js ≥ 20 (built-in `fetch`/`crypto` — this package has **zero** runtime dependencies)
- `@playwright/test` ≥ 1.40 (a peer dependency)

## License

MIT
