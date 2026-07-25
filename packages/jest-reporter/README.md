# `@nohotfix/jest-reporter`

Report your [Jest](https://jestjs.io) results into [NoHotfix](https://nohotfix.com) so they drive
the run's Go/No-Go gate — **no curl step, no JUnit file, no `[nhf:key]` title token**. Install one
package, add one line to your config, set two CI secrets, and tag each automated test with its
NoHotfix `ci_key`.

> **It never breaks your build.** NoHotfix being down, a renamed `ci_key`, or a transient
> network error will only ever print a warning — your test job stays green. It fails clearly
> *only* on a bad token (401/403) or a malformed payload (400), which are real setup errors.

Requires **Jest v29+** (a peer dependency) with the default `injectGlobals: true` (so the tag helper
can read the current test from `expect.getState()`).

## 1. Install

```bash
npm install -D @nohotfix/jest-reporter
# or: pnpm add -D @nohotfix/jest-reporter
```

## 2. Add the reporter (one line)

```js
// jest.config.js
/** @type {import('jest').Config} */
module.exports = {
  reporters: ['default', '@nohotfix/jest-reporter'], // ← the whole integration
};
```

## 3. Set two CI secrets

| Secret | Value |
|---|---|
| `NOHOTFIX_INGEST_TOKEN` | from NoHotfix → Settings → Integrations |
| `NOHOTFIX_ENVIRONMENT` | e.g. `production` or `staging` |

```yaml
# .github/workflows/ci.yml — the commit is auto-resolved from GITHUB_SHA
- run: npx jest
  env:
    NOHOTFIX_INGEST_TOKEN: ${{ secrets.NOHOTFIX_INGEST_TOKEN }}
    NOHOTFIX_ENVIRONMENT: production
```

## 4. Tag each automated test

```ts
import { nhf } from '@nohotfix/jest-reporter/globals';

test('checkout completes for a new user', () => {
  nhf.tag('checkout.new-user.complete'); // the ci_key from your NoHotfix library
  expect(checkout()).toBe('ok');
});
```

`nhf.tag('<ci_key>')` records the key against the current test (read from `expect.getState()`) and
bridges it to the reporter — no title token, no Jest internals in your test file. A test with **no**
tag (or an empty/whitespace key) is omitted, so you can migrate test-by-test. Because the key is
bound to the running test, it moves with a title/describe rename, and it is scoped to its spec file —
reusing the same test name across different files is fine.

CommonJS test files work the same way:

```js
const { nhf } = require('@nohotfix/jest-reporter/globals');
```

## Validate without touching the gate (dry-run)

```bash
NOHOTFIX_INGEST_TOKEN=nhf_xxx NOHOTFIX_ENVIRONMENT=production \
  NOHOTFIX_DRY_RUN=true npx jest
# Validates the token via GET /api/ci/ping, prints what WOULD be sent, POSTs nothing.
```

## Sharded / matrix runs

```yaml
- run: npx jest --shard=${{ matrix.shard }}/${{ matrix.total }}
  env:
    NOHOTFIX_INGEST_TOKEN: ${{ secrets.NOHOTFIX_INGEST_TOKEN }}
    NOHOTFIX_ENVIRONMENT: production
```

Each shard submits independently; NoHotfix fans them in. Re-running a shard is a no-op — the shard
index (`--shard=N/M`, or `JEST_SHARD_INDEX`) folds into the submission's `Idempotency-Key`.

## Configuration

All options can be set via env var (preferred — they take priority) or the reporter options object
(`['@nohotfix/jest-reporter', { environment: 'production' }]`).

| Env var | Option | Required | Meaning |
|---|---|---|---|
| `NOHOTFIX_INGEST_TOKEN` | — (secret) | **yes** | org-scoped ingest token |
| `NOHOTFIX_ENVIRONMENT` | `environment` | **yes** | the run's environment |
| `NOHOTFIX_API_URL` | `apiUrl` | no | self-hosted override (default `https://api.nohotfix.com`) |
| `NOHOTFIX_COMMIT` | `commit` | no | override; else auto-resolved from CI |
| `NOHOTFIX_DRY_RUN` | `dryRun` | no | validate + print, submit nothing |
| `JEST_SHARD_INDEX` | — | no | shard identity (else parsed from `--shard`) |

## What you'll see

```
[NoHotfix] Submitted 14 result(s) to https://api.nohotfix.com — 12 accepted, 2 ignored.
[NoHotfix]   ✓ checkout.new-user.complete  passed  842ms
[NoHotfix]   ↷ billing.retry  failed  120ms  (archived_test)
```

In GitHub Actions the same disposition is written to the job's step summary.

## How the tag reaches the reporter

Jest runs tests in **worker processes** and its result objects carry no custom metadata, so the
`ci_key` can't ride back on the test result. `nhf.tag` writes it to a small temp file keyed by the
current test's file + name; the reporter reads those files once at `onRunComplete` and joins them to
the results. The temp files are cleared at the start and end of every run. (`reportedAt` is therefore
omitted for Jest — its results expose no per-test timestamp; `durationMs` is still reported.)

## Migrating off the JUnit / title-token path and the 065 Action

This reporter supersedes the raw JUnit-token POST and the
[`nohotfix/report-results`](https://github.com/nohotfix/report-results) GitHub Action — but both
remain a permanent, universal fallback.

You can adopt it **test-by-test**: only tagged tests are submitted, so a mixed suite reports its
tagged subset and leaves the rest to the fallback. The reporter emits the *exact same* 056 ingestion
contract (`commit` + `environment` + `results[]`) the JUnit/title-token path and the Action produce,
so both can target the **same commit + environment** during a migration — the server converges them
(last write wins). Once every automated test carries an `nhf.tag`, remove the `[nhf:ci_key]` title
tokens and the Action step. Nothing server-side changes.

## Requirements & limitations

- Node.js ≥ 20 (built-in `fetch`/`crypto` — this package has **zero** runtime dependencies)
- Jest ≥ 29 (a peer dependency), running the default **`jest-circus`** test runner with
  **`injectGlobals: true`** (both are Jest defaults). `nhf.tag` reads the current test from the
  global `expect.getState()`; with `injectGlobals: false` (import-from-`@jest/globals` style) or the
  legacy `jest-jasmine2` runner it safely no-ops rather than mis-tagging.
- **`test.concurrent` is supported** — `nhf.tag` uses Jest's concurrency-safe test name
  (`currentConcurrentTestName`) so interleaved concurrent tests attribute correctly.
- The tag bridge uses a temp dir derived from the working directory. Running **two `jest` processes
  for the same project in the same directory at once** would share that dir; in practice CI shards
  run in separate containers, so this is a non-issue — but avoid it locally, or shard via separate
  working directories.

## License

MIT
