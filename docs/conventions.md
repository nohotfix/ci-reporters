# Conventions: annotation · status mapping · commit & environment

Three shared producer rules every reporter obeys. They live in `ci-core` (the shared parts) and
in each reporter's `src/map.ts` (the runner-specific glue).

## 1. The `ci_key` annotation

Each automated test is bound to its NoHotfix **`ci_key`** — the library identifier the server
matches on. The legacy raw path carries it as a **`[nhf:<ci_key>]` title token**; a first-party
reporter replaces that token with a **structured tag** so the binding survives title/describe/file
renames and no runner internals leak into the test file:

- **Playwright** — an annotation `{ type: 'nhf', description: '<ci_key>' }` (config-level or a
  runtime `test.info().annotations.push(...)`). Read by `readCiKey` via the reserved
  `NHF_ANNOTATION_TYPE = 'nhf'`.
- **Vitest** — reserved task metadata `ctx.task.meta.nhfKey = '<ci_key>'`, written ergonomically
  by `nhf.tag(ctx, '<ci_key>')`. Read by `readCiKey` via `NHF_META_KEY = 'nhfKey'`.

Rules (identical across runners, enforced in `map.ts`'s `readCiKey`):

- Trim the value; the **first** non-empty `nhf` tag wins.
- An **untagged** test (no tag, or an empty/whitespace value) reads as `null` and is **omitted**
  from submission — so a suite can migrate test-by-test.

A new reporter picks whatever native tagging mechanism its runner offers and normalizes it in
`readCiKey`; everything downstream is `ci-core`.

## 2. Status mapping — final-attempt, never silently `passed`

The shared policy is `ci-core`'s `mapStatus(outcome)`, over a runner-agnostic `RunnerOutcome`
(`'passed' | 'failed' | 'error' | 'skipped'`):

| RunnerOutcome | Server status |
|---|---|
| `passed` | `passed` |
| `failed` (assertion/expectation) | `failed` |
| `error` (thrown/timeout/crash/interrupt/infra) | `broken` |
| `skipped` | `skipped` |
| **anything else (unknown/ambiguous)** | **`broken`** |

Two invariants:

- **Never silently `passed`.** An unknown or non-terminal state maps to `broken`, so the gate is
  never *falsely satisfied*. Each reporter's `map<Runner>Status` funnels every unrecognized state
  through `mapStatus('error')`/default → `broken` (see Vitest `pending`→broken, Playwright
  `timedOut`/`interrupted`→broken).
- **Report the final attempt.** Retries are the *reporter's* job, not `mapStatus`'s (which is
  pure). Each reporter keeps a per-test-id map and keeps the highest-retry (last) attempt — see
  `onTestEnd`/`onTestCaseResult`.

## 3. Commit auto-detect; environment never defaulted

**Commit** (`ci-core/commit.ts`, `resolveCommit`): an explicit override first
(`NOHOTFIX_COMMIT` / the `commit` option), then recognized CI-provider variables, in order:

```
GITHUB_SHA · CI_COMMIT_SHA · CIRCLE_SHA1 · BUILDKITE_COMMIT
```

If none resolve, the commit is `null` and the reporter **skips submission with a clear warning**.
It **never** guesses (e.g. `git rev-parse HEAD`) — a guessed SHA is wrong in detached/shallow CI
checkouts and would silently corrupt a gate.

**Environment** (`ci-core/config.ts`, `resolveConfig`): `NOHOTFIX_ENVIRONMENT` (or the
`environment` option) is **required** and **never defaulted**. A missing environment throws
`ReporterConfigError` up front, before any test work is wasted. There is no "prod by default" —
because environment is part of the exact-match key, a wrong default matches the wrong run.

Env vars always take priority over reporter options (`resolveConfig`).
</content>
