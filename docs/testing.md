# Testing principles

Tests live beside their source in `src/__tests__/*.test.ts` and run under **Vitest**
(`pnpm test` → `turbo run test`; per-package `vitest run`). Four kinds, each earning its place.

## 1. Unit the pure logic

The core is deliberately pure so it can be tested without a network or a runner:

- `ci-core`: `mapStatus`, `resolveCommit`, `resolveConfig`, `buildIdempotencyKey`/`chunk`,
  `buildSummaryLines`, and `submitResults`/`submitAll` (with an injected `fetchImpl`).
- Each reporter's `src/map.ts`: `map<Runner>Status` (every terminal state + the unknown→`broken`
  case), `readCiKey` (tagged / trimmed / untagged-null / non-string), `resolveShardSuffix`
  (override / parsed / unsharded / distinct-shards-distinct-keys).

Reporters inject `env`, `fetchImpl`, `logger`, `setExitCode`, `sleep`, `appendFile` via the
constructor's test hooks — so the whole reporter is driveable in a unit test with no real CI.

## 2. Stays green against an unreachable API (fault injection)

The resilience promise ([`resilience.md`](resilience.md)) is a **test**, not a hope. Drive the
transport with an injected `fetchImpl` that returns/raises each failure mode and assert the
outcome:

- `429` / `5xx` / a thrown network error → `warned`, **never** throws, exit code untouched.
- `401` / `403` → throws `CiTransportError('auth')`; `400` → `CiTransportError('malformed')`.
- Retry/back-off is exercised with an injected `sleep` so tests don't wait on real timers.

The bar: **an unreachable or misbehaving NoHotfix must leave the test job green.**

## 3. The 056 contract test

Every reporter has a `contract.test.ts` that drives the reporter to capture a real emitted
`SubmitRequest`, then validates it against the **vendored 056 fixture**
(`packages/ci-core/src/__tests__/fixtures/server-schema.ts`, `IngestResultsRequestSchema`). The
fixture is *loaded*, never re-defined, so every reporter is held to the exact same contract. A red
contract test means either a reporter bug or contract drift — reconcile via
[`/contract-check`](../.claude/commands/contract-check.md). See [`ingestion-contract.md`](ingestion-contract.md).

## 4. Examples-as-dogfood

Each reporter ships an `examples/<runner>-app` — a real annotated suite wired to the reporter via
`workspace:*`. It is the live acceptance: point it at a NoHotfix API, run it, and watch a real
automated member flip and re-evaluate the gate. It also proves the published-shape wiring (config
line, tag helper, dry-run, shards) end-to-end. Keep the dogfood assertions trivial (`2 + 2`) — the
point is the *reporting*, not the test's subject.

`zod` is a **test-only** devDependency (the contract oracle) and never enters a reporter's
runtime — the reporters keep **zero runtime dependencies** (Node 20 built-in `fetch`/`crypto`).

## 5. Live E2E (real API, real gate flip) — driven by `nohotfix.com`

Each reporter also ships an `examples/<runner>-e2e` **live** harness — the reporter wired as a
customer would, tagging a single test with a `ci_key` and submitting to a **real** NoHotfix. It is
env-driven and inert without it: skipped unless `NHF_E2E_CI_KEY` (plus the reporter env —
`NOHOTFIX_API_URL` / `_INGEST_TOKEN` / `_ENVIRONMENT` / `_COMMIT`) is set. The **`nohotfix.com`** E2E
workflow boots the API, seeds a run, discovers an in-progress automated `ci_key`, invokes the
harness with that env, and asserts the member flipped in the database — the one check that the whole
integration (not just the emitted payload) works. This repo's own CI never sets that env, so these
stay skipped/untouched here.

| Harness | Script | Runs under `pnpm test`? | Wired into `nohotfix.com` E2E workflow? |
|---|---|---|---|
| `examples/vitest-e2e` | `test` | yes — a `test.skipIf` skips in milliseconds when unset | ✅ yes |
| `examples/playwright-e2e` | `test` | yes — `test.skip` at runtime; the test uses no `page`, so no browser | ⬜ **pending** — harness ready here; invocation not yet added to `nohotfix.com` |
| `examples/jest-e2e` | `test` | yes — `test.skip` when unset; Jest boots but needs no browser | ⬜ **pending** — harness ready here; invocation not yet added to `nohotfix.com` |
| `examples/cypress-e2e` | **`e2e`** | **no** — `cypress run` always needs the Cypress binary + Electron, so it is invoked explicitly by the pipeline, never by unit CI | ⬜ **pending** — harness ready here; invocation not yet added to `nohotfix.com` (its workflow must install the Cypress binary + run `pnpm --filter @nohotfix/e2e-cypress-live e2e`) |

> **Cross-repo follow-up (tracked here, deliberately batched):** the last column is the outstanding
> work, and it lives in the **`nohotfix.com`** repo, not this one. The plan is to **build the reporters
> out first (each shipping a ready, validated `examples/<runner>-e2e` harness), then wire them all into
> the `nohotfix.com` E2E workflow in one pass** — rather than round-tripping to the other repo per
> reporter. The `vitest-e2e` harness is already driven by that workflow; `playwright-e2e` and
> `cypress-e2e` exist and are validated here (they emit the correct payload against a dry-run) but the
> workflow does **not** yet invoke them. Until it does, the live gate-flip is proven for Vitest only —
> Playwright and Cypress are covered by contract tests + manual dogfood. When a new reporter lands, add
> its `examples/<runner>-e2e` row with a ⬜; flip a cell to ✅ once the `nohotfix.com` workflow drives it.

For the concrete recipe when adding tests to a new reporter, use the **`reporter-testing`** skill
(`.claude/skills/reporter-testing/`).
</content>
