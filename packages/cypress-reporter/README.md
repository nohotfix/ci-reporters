# `@nohotfix/cypress-reporter`

Report your [Cypress](https://cypress.io) results into [NoHotfix](https://nohotfix.com) so they
drive the run's Go/No-Go gate — **no curl step, no JUnit file, no `[nhf:key]` title token**.
Install one package, wire it in `setupNodeEvents` with one line, set two CI secrets, and tag each
automated test with its NoHotfix `ci_key`.

> **It never breaks your build.** NoHotfix being down, a renamed `ci_key`, or a transient
> network error will only ever print a warning — your test job stays green. It fails clearly
> *only* on a bad token (401/403) or a malformed payload (400), which are real setup errors.

Requires **Cypress v13+** (a peer dependency) and runs in `cypress run` (it submits from the
`after:run` hook). On older Cypress, use the JUnit +
[`nohotfix/report-results`](https://github.com/nohotfix/report-results) Action fallback until you
upgrade (see [Migrating](#migrating-off-the-junit--title-token-path-and-the-065-action) below).

## 1. Install

```bash
npm install -D @nohotfix/cypress-reporter
# or: pnpm add -D @nohotfix/cypress-reporter
```

## 2. Wire the plugin (one line)

```ts
// cypress.config.ts
import { defineConfig } from 'cypress';
import { setupNoHotfix } from '@nohotfix/cypress-reporter';

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      setupNoHotfix(on, config); // ← the whole integration
      return config;
    },
  },
});
```

`setupNoHotfix` registers the reserved `nhf` task (the browser → Node bridge) and the `after:run`
submit hook. If you register your own `on('task', …)` handlers, keep them — Cypress merges task
maps across registrations.

## 3. Set two CI secrets

| Secret | Value |
|---|---|
| `NOHOTFIX_INGEST_TOKEN` | from NoHotfix → Settings → Integrations |
| `NOHOTFIX_ENVIRONMENT` | e.g. `production` or `staging` |

```yaml
# .github/workflows/ci.yml — the commit is auto-resolved from GITHUB_SHA
- run: npx cypress run
  env:
    NOHOTFIX_INGEST_TOKEN: ${{ secrets.NOHOTFIX_INGEST_TOKEN }}
    NOHOTFIX_ENVIRONMENT: production
```

## 4. Tag each automated test

```ts
import { nhf } from '@nohotfix/cypress-reporter/support';

it('checkout completes for a new user', () => {
  nhf.tag('checkout.new-user.complete'); // the ci_key from your NoHotfix library
  cy.visit('/checkout');
  // ...assertions
});
```

`nhf.tag('<ci_key>')` records the key against the current test (over the reserved `cy.task`) — no
Cypress internals leak into your test file. A test with **no** tag (or an empty/whitespace key) is
omitted, so you can migrate test-by-test. Because the key is bound to the running test, it moves
with a title/describe rename, and the tag is scoped to its spec file — reusing the same test title
across different specs is fine.

## Validate without touching the gate (dry-run)

```bash
NOHOTFIX_INGEST_TOKEN=nhf_xxx NOHOTFIX_ENVIRONMENT=production \
  NOHOTFIX_DRY_RUN=true npx cypress run
# Validates the token via GET /api/ci/ping, prints what WOULD be sent, POSTs nothing.
```

## Sharded / parallel runs

Cypress has no native `--shard` flag — jobs split specs across machines themselves (or via a
parallelization service). Give each shard a distinct index so their submissions stay independent:

```yaml
- run: npx cypress run --spec "${{ matrix.specs }}"
  env:
    NOHOTFIX_INGEST_TOKEN: ${{ secrets.NOHOTFIX_INGEST_TOKEN }}
    NOHOTFIX_ENVIRONMENT: production
    CYPRESS_SHARD_INDEX: ${{ matrix.shard }}
```

Each shard submits independently; NoHotfix fans them in. Re-running a shard is a no-op — the shard
index folds into the submission's `Idempotency-Key`.

## Configuration

All options can be set via env var (preferred — they take priority) or the third argument to
`setupNoHotfix(on, config, { environment: 'production' })`.

| Env var | Option | Required | Meaning |
|---|---|---|---|
| `NOHOTFIX_INGEST_TOKEN` | — (secret) | **yes** | org-scoped ingest token |
| `NOHOTFIX_ENVIRONMENT` | `environment` | **yes** | the run's environment |
| `NOHOTFIX_API_URL` | `apiUrl` | no | self-hosted override (default `https://api.nohotfix.com`) |
| `NOHOTFIX_COMMIT` | `commit` | no | override; else auto-resolved from CI |
| `NOHOTFIX_DRY_RUN` | `dryRun` | no | validate + print, submit nothing |
| `CYPRESS_SHARD_INDEX` | — | no | shard identity (else `0`, unsharded) |

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
remain a permanent, universal fallback.

You can adopt it **test-by-test**: only tagged tests are submitted, so a mixed suite reports its
tagged subset and leaves the rest to the fallback. The reporter emits the *exact same* 056
ingestion contract (`commit` + `environment` + `results[]`) the JUnit/title-token path and the
Action produce, so both can target the **same commit + environment** during a migration — the
server converges them (last write wins). Once every automated test carries an `nhf.tag`, remove
the `[nhf:ci_key]` title tokens and the Action step. Nothing server-side changes.

## Requirements

- Node.js ≥ 20 (built-in `fetch`/`crypto` — this package has **zero** runtime dependencies)
- Cypress ≥ 13 (a peer dependency), run via `cypress run`

## License

MIT
