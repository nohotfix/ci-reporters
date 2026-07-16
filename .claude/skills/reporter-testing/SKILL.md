# Reporter testing

TRIGGER: When writing or reviewing tests for a NoHotfix reporter (or `ci-core`) in this repo —
especially after scaffolding a new `packages/<runner>-reporter`, or when a `map`/reporter/contract
test is missing or red.

The recipe below implements the principles in [`docs/testing.md`](../../../docs/testing.md). Tests
live in `packages/<pkg>/src/__tests__/*.test.ts` and run under Vitest (`pnpm test`). Model them on
`packages/vitest-reporter/src/__tests__/` and `packages/ci-core/src/__tests__/`.

## The four kinds (write all four for a reporter)

### 1. `map.test.ts` — pure runner glue

Unit `src/map.ts` directly (no network, no runner process):

- `map<Runner>Status`: assert **every terminal state** (`passed`/`failed`/`skipped`) maps correctly
  and **every unknown/non-terminal/infra state maps to `broken`** — never `passed`.
- `readCiKey`: tagged value returned; **trimmed**; untagged → `null`; empty/whitespace → `null`;
  non-string metadata → `null`.
- `resolveShardSuffix`: env override wins; parsed `--shard` index; `'0'` unsharded; distinct shards
  → distinct suffixes; same shard re-run → identical suffix.

### 2. `reporter.test.ts` — drive the reporter with injected hooks (fault injection)

Construct the reporter with test hooks (`env`, `fetchImpl`, `logger`, `setExitCode`, `sleep`,
`appendFile`) and a minimal runner `TestCase` double. Assert the **resilience contract**:

- unreachable API / thrown network error / `5xx` / `429` → **`warned`**, no throw, `setExitCode`
  **never** called with 1 (job stays green). Inject `sleep` so back-off is instant.
- `401`/`403` → fail clearly (`setExitCode(1)`); `400` → fail clearly.
- no commit resolvable → warn + skip (nothing submitted); missing token/env → config error surfaced,
  build **not** failed.
- dry-run → `ping` called, nothing POSTed.

### 3. `contract.test.ts` — the 056 oracle

Drive the reporter to capture a real emitted `SubmitRequest` (via a `fetchImpl` that records
`init.body`), then validate it against the **vendored** fixture — loaded, not re-defined:

```
packages/ci-core/src/__tests__/fixtures/server-schema.ts → IngestResultsRequestSchema
```

Load it by a variable specifier (as `vitest-reporter`'s contract test does) so `tsc` doesn't pull
`ci-core`'s test file under this package's `rootDir`. Cover a representative mix (passed / failed /
unknown→broken / skipped). A red contract test = a reporter bug **or** contract drift → run
[`/contract-check`](../../commands/contract-check.md).

### 4. Examples-as-dogfood

Keep `examples/<runner>-app` runnable: an `nhf`-tagged suite (trivial assertions), the one-line
config, a README covering install → config → tag → dry-run → shards. It is the live acceptance
against a real NoHotfix API.

## Run

```bash
pnpm turbo run test              # all packages (respects ^build)
pnpm --filter @nohotfix/<runner>-reporter test
```

`zod` is a **test-only** devDependency (the contract oracle) — never add it to a reporter's runtime
deps. Reporters keep zero runtime dependencies (Node 20 built-in `fetch`/`crypto`).
</content>
