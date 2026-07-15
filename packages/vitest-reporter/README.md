# `@nohotfix/vitest-reporter`

Report your [Vitest](https://vitest.dev) results into [NoHotfix](https://nohotfix.com) so they
drive the run's Go/No-Go gate — **no curl step, no JUnit file, no `[nhf:key]` title token**.
Install one package, add one line to your config, set two CI secrets, and tag each automated
test with its NoHotfix `ci_key`.

> **It never breaks your build.** NoHotfix being down, a renamed `ci_key`, or a transient
> network error will only ever print a warning — your test job stays green. It fails clearly
> *only* on a bad token (401/403) or a malformed payload (400), which are real setup errors.

Requires **Vitest v3+** (a peer dependency). On Vitest v2 or earlier, use the JUnit +
[`nohotfix/report-results`](https://github.com/nohotfix/report-results) Action fallback until you
upgrade (see [Migrating](#migrating-off-the-junit--title-token-path-and-the-065-action) below).

## 1. Install

```bash
npm install -D @nohotfix/vitest-reporter
# or: pnpm add -D @nohotfix/vitest-reporter
```

## 2. Add the reporter (one line)

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['default', '@nohotfix/vitest-reporter'], // ← the whole integration
  },
});
```

## 3. Set two CI secrets

| Secret | Value |
|---|---|
| `NOHOTFIX_INGEST_TOKEN` | from NoHotfix → Settings → Integrations |
| `NOHOTFIX_ENVIRONMENT` | e.g. `production` or `staging` |

```yaml
# .github/workflows/ci.yml — the commit is auto-resolved from GITHUB_SHA
- run: npx vitest run
  env:
    NOHOTFIX_INGEST_TOKEN: ${{ secrets.NOHOTFIX_INGEST_TOKEN }}
    NOHOTFIX_ENVIRONMENT: production
```

## 4. Tag each automated test

```ts
import { test, expect } from 'vitest';
import { nhf } from '@nohotfix/vitest-reporter';

test('checkout completes for a new user', (ctx) => {
  nhf.tag(ctx, 'checkout.new-user.complete'); // the ci_key from your NoHotfix library
  expect(await checkout()).toBe('ok');
});
```

`nhf.tag(ctx, '<ci_key>')` writes the key onto the test's metadata — no Vitest internals leak
into your test file. A test with **no** tag (or an empty/whitespace key) is omitted, so you can
migrate test-by-test. The binding survives title/describe/file renames.

Equivalent raw-metadata path (no helper import):

```ts
test('checkout completes for a new user', (ctx) => {
  ctx.task.meta.nhfKey = 'checkout.new-user.complete';
});
```

## Validate without touching the gate (dry-run)

```bash
NOHOTFIX_INGEST_TOKEN=nhf_xxx NOHOTFIX_ENVIRONMENT=production \
  NOHOTFIX_DRY_RUN=true npx vitest run
# Validates the token via GET /api/ci/ping, prints what WOULD be sent, POSTs nothing.
```

## Sharded / matrix runs

```yaml
- run: npx vitest run --shard=${{ matrix.shard }}/${{ matrix.total }}
  env:
    NOHOTFIX_INGEST_TOKEN: ${{ secrets.NOHOTFIX_INGEST_TOKEN }}
    NOHOTFIX_ENVIRONMENT: production
```

Each shard submits independently; NoHotfix fans them in. Re-running a shard is a no-op — the
shard index folds into the submission's `Idempotency-Key`.

## Configuration

All options can be set via env var (preferred — they take priority) or the reporter options
object (`['@nohotfix/vitest-reporter', { environment: 'production' }]`).

| Env var | Option | Required | Meaning |
|---|---|---|---|
| `NOHOTFIX_INGEST_TOKEN` | — (secret) | **yes** | org-scoped ingest token |
| `NOHOTFIX_ENVIRONMENT` | `environment` | **yes** | the run's environment |
| `NOHOTFIX_API_URL` | `apiUrl` | no | self-hosted override (default `https://api.nohotfix.com`) |
| `NOHOTFIX_COMMIT` | `commit` | no | override; else auto-resolved from CI |
| `NOHOTFIX_DRY_RUN` | `dryRun` | no | validate + print, submit nothing |
| `VITEST_SHARD_INDEX` | — | no | shard identity (else parsed from `--shard`) |

## What you'll see

```
[NoHotfix] Submitted 14 result(s) to https://api.nohotfix.com — 12 accepted, 2 ignored.
[NoHotfix]   ✓ checkout.new-user.complete  passed  842ms
[NoHotfix]   ↷ billing.retry  failed  120ms  (archived_test)
```

In GitHub Actions the same disposition is written to the job's step summary.

## Migrating off the JUnit / title-token path and the 065 Action

This reporter supersedes the raw JUnit-token POST and the
[`nohotfix/report-results`](https://github.com/nohotfix/report-results) GitHub Action — but both
remain a permanent, universal fallback (and the only path on Vitest v2).

You can adopt it **test-by-test**: only tagged tests are submitted, so a mixed suite reports its
tagged subset and leaves the rest to the fallback. The reporter emits the *exact same* 056
ingestion contract (`commit` + `environment` + `results[]`) the JUnit/title-token path and the
Action produce, so both can target the **same commit + environment** during a migration — the
server converges them (last write wins). Once every automated test carries an `nhf.tag`, remove
the `[nhf:ci_key]` title tokens and the Action step. Nothing server-side changes.

## Requirements

- Node.js ≥ 20 (built-in `fetch`/`crypto` — this package has **zero** runtime dependencies)
- Vitest ≥ 3.0 (a peer dependency)

## License

MIT
