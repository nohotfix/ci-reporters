# Anatomy of a reporter — how to add one

**This is the key expansion guide.** Adding a first-party reporter for a new runner (Cypress, Jest,
…) is the headline self-service task. Every reporter mirrors the shipped `playwright-reporter` /
`vitest-reporter` shape: a thin per-runner adapter over the shared, unchanged `@nohotfix/ci-core`.
The `/new-reporter <runner>` command scaffolds all of this; this doc explains each piece so you can
fill in the runner-specific glue (and so the scaffold and the doc can't diverge).

> **Golden rule:** only two files hold runner-specific code — `src/index.ts` (the reporter hook)
> and `src/map.ts` (the glue). Everything else is reused from `ci-core` or copied verbatim from an
> existing reporter. If you find yourself re-implementing transport, idempotency, config, commit,
> or summary logic, stop — it already lives in `ci-core`.

Grounding: read `packages/vitest-reporter/src/{index,map}.ts` and
`packages/playwright-reporter/src/{index,map}.ts` alongside this guide. They are the template.

## The pieces (in order)

### 1. Peer-dep the runner

In `packages/<runner>-reporter/package.json`:

- `peerDependencies`: the runner (e.g. `"cypress": ">=13.0.0"`) — **never a regular dep, never
  bundled**. The customer already has the runner installed.
- `devDependencies`: the same runner (so the package builds/tests here).
- `dependencies`: `"@nohotfix/ci-core": "workspace:*"` — the only real dep; tsup bundles it in.
- `publishConfig`: `{ "access": "public", "provenance": true }`; `files: ["dist", "README.md"]`;
  `type: "module"`; dual `exports` (types/import/require); `engines.node >= 20`.
- `scripts`: `build: tsup`, `typecheck: tsc --noEmit`, `test: vitest run`,
  `lint: prettier --check "src/**/*.ts"`, `clean: rm -rf dist .turbo`.

### 2. Bundle `ci-core` (tsup)

Copy `tsup.config.ts` from an existing reporter and change only the `external` list:

```ts
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true, clean: true, sourcemap: true, target: 'node20',
  noExternal: [/@nohotfix\/ci-core/],   // bundle the private core IN
  external: ['<runner>', /* its subpaths, e.g. '<runner>/reporter' */], // keep the runner OUT
});
```

See [`build-and-bundling.md`](build-and-bundling.md) for the why.

### 3. Implement `src/map.ts` (the runner glue)

Four exports, mirroring the existing reporters:

- **`NHF_<KEY>`** — the reserved tag constant. Pick the runner's native per-test tagging mechanism
  (Playwright: an annotation `type`; Vitest: a `task.meta` key). Define it once.
- **`map<Runner>Status(nativeState): EmittableCiStatus`** — map the runner's native outcomes onto
  `ci-core`'s `mapStatus`. Map the clearly-passing/failing/skipped states; funnel **every**
  unknown/non-terminal/infra state through `mapStatus('error')`/default → `broken`. **Never map an
  unknown state to `passed`** (see [`conventions.md`](conventions.md)).
- **`readCiKey(...): string | null`** — read the `ci_key` from the runner's tag: trim it, take the
  first non-empty `nhf` tag, return `null` when untagged (that test is then omitted).
- **`resolveShardSuffix(env, config?): string`** — the shard identity for idempotency: an env
  override (`<RUNNER>_SHARD_INDEX`) → the runner's parsed `--shard` index → `'0'` unsharded.
  Distinct shards must yield distinct suffixes; a re-run of a shard must reproduce its suffix.

### 4. Implement `src/index.ts` (the reporter hook)

A default class implementing the runner's `Reporter` interface. Copy the structure from
`vitest-reporter` / `playwright-reporter` and re-wire only the runner's lifecycle hook names:

- A stable **`const REPORTER_NAME = '<runner>'`** (feeds the idempotency identity — keep it fixed
  across versions).
- **Constructor** — accept `ReporterOptions` plus the test hooks (`env`, `fetchImpl`, `logger`,
  `setExitCode`, `retries`, `sleep`, `appendFile`) so the reporter is fully unit-driveable.
- **On begin** (`onBegin`/`onInit`/equivalent) — `resolveShardSuffix`, then
  `resolveConfig(env, options)` and `resolveCommit(env, config.commitOverride)`. On a
  `ReporterConfigError`, `log.error` it and stash it — surfaced early, but **not** a build failure.
- **Per test** (`onTestEnd`/`onTestCaseResult`/equivalent) — `readCiKey`; skip if `null`. Keep the
  **final attempt** per test id (highest retry wins). Store `{ ciKey, status: map<Runner>Status(...),
  durationMs, retry, reportedAt? }`.
- **On end** (`onEnd`/`onTestRunEnd`/equivalent) — bail if there was a config error; build
  `CiResultInput[]`; if empty, log "nothing to submit"; if no commit, warn + skip
  (`unresolvedCommitMessage()`). Otherwise:
  - **dry-run** (`config.dryRun`) → `ping(config, { ciKey })` + `writeSummary(..., { dryRun: true,
    lines: buildSummaryLines(results, null, { pending: true }) })`. POST nothing.
  - **normal** → `submitAll(config, request, { fetchImpl, retries, sleep, identity: {
    reporterName: REPORTER_NAME, shardSuffix } })`, then `writeSummary` (render the per-test table
    only when a disposition came back; else just the warnings). Catch `CiTransportError` →
    `log.error` + `setExitCode(1)` — **the only red path** (see [`resilience.md`](resilience.md)).
- Export the customer-facing tag helper if the runner benefits from one (Vitest's `nhf.tag(ctx,
  key)`); re-export the `map.ts` symbols.

### 5. `submitAll` with the shard-aware idempotency identity

Always pass `identity: { reporterName: REPORTER_NAME, shardSuffix }` to `submitAll`. `ci-core`
derives a content-addressed `Idempotency-Key` per chunk (`sha256(commit ⋄ environment ⋄
reporterName ⋄ shardSuffix [⋄ chunkN])`), so distinct shards never collide and a shard re-run
no-ops server-side. `submitAll` also chunks beyond `MAX_RESULTS_PER_CALL` (2000) for you.

### 6. `writeSummary`

Call `ci-core`'s `writeSummary` with `summaryDeps()` (`info`/`warn`/`env`/`appendFile`). It prints
the per-test disposition to the console and, in GitHub Actions, appends the same table to the job
step summary. Don't hand-roll output.

## The surround (make it real)

- **`examples/<runner>-app`** — a dogfood suite wired via `workspace:*`, an `nhf`-tagged test or
  two (trivial assertions), the one-line reporter config, and a README showing install → config →
  tag → dry-run → shards. This is the live acceptance (see [`testing.md`](testing.md)).
- **`src/__tests__/`** — `map.test.ts` (status/readCiKey/shard units), `reporter.test.ts`
  (fault-injection: unreachable API stays green; 401/403/400 fail clearly), `contract.test.ts`
  (the emitted `SubmitRequest` validates against the vendored 056 fixture). Use the
  **`reporter-testing`** skill.
- **`README.md`** — mirror an existing reporter's README (install, config line, two secrets, tag,
  dry-run, shards, config table, migration note).
- **`CHANGELOG.md`** — start at `0.1.0 (unreleased)`; stays `0.x` until dogfooded against a live
  run, then `1.0.0`.
- **Release matrix** — add the new package to the `workflow_dispatch` `options:` list in
  `.github/workflows/release.yml` (see [`releasing.md`](releasing.md)).

## Finish

Run [`/verify`](../.claude/commands/verify.md) (`pnpm turbo run build typecheck lint test`) — green
proves the scaffold. Then [`/contract-check`](../.claude/commands/contract-check.md) confirms the
056 mirror is current. The **`reporter-integration-architect`** agent guides the whole flow.
</content>
