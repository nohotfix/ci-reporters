# Architecture

A pnpm + Turborepo monorepo of thin, per-runner reporters over one shared private core.

## Layout

```
ci-reporters/
├── packages/
│   ├── ci-core/                 # PRIVATE, bundled into each reporter (never published)
│   │   └── src/ { types, status, commit, config, idempotency, transport, summary }.ts
│   │       └── __tests__/fixtures/server-schema.ts   # the vendored 056 oracle
│   ├── playwright-reporter/     # published: @nohotfix/playwright-reporter
│   │   └── src/ { index.ts (Reporter class), map.ts (runner glue) }
│   └── vitest-reporter/         # published: @nohotfix/vitest-reporter
│       └── src/ { index.ts, map.ts }
├── examples/                    # dogfood apps, wired via workspace:*
│   ├── playwright-app/  vitest-app/  vitest-e2e/
├── turbo.json                   # build/typecheck/test/lint/clean pipeline
├── pnpm-workspace.yaml          # packages/*  +  examples/*
└── .github/workflows/           # ci.yml (PR gate)  ·  release.yml (OIDC publish)
```

## `ci-core` — private, bundled

`ci-core` holds the ~70% of logic that is identical for every runner. It is **`private: true`**
and **never published**: tsup bundles it *into* each reporter (`noExternal`), so a customer
installs exactly one package and there is no public `ci-core` API to version.

| Module | Exports | Responsibility |
|---|---|---|
| `types.ts` | `CiStatus`, `EmittableCiStatus`, `CiResultInput`, `SubmitRequest`, `IngestionDisposition`, `PingResult`, `ReporterConfig`, … | the in-memory model mirroring the 056 contract |
| `status.ts` | `mapStatus`, `RunnerOutcome` | runner outcome → server status (never silently `passed`) |
| `commit.ts` | `resolveCommit`, `COMMIT_ENV_VARS`, `unresolvedCommitMessage` | CI-provider commit auto-detect (never invents one) |
| `config.ts` | `resolveConfig`, `ReporterConfigError`, `DEFAULT_API_URL` | env > options, required-field validation |
| `idempotency.ts` | `buildIdempotencyKey`, `chunk`, `MAX_RESULTS_PER_CALL` | content-addressed key + 2000-cap chunking |
| `transport.ts` | `submitResults`, `submitAll`, `ping`, `CiTransportError` | resilient-by-default POST + the warn-vs-fail matrix |
| `summary.ts` | `writeSummary`, `buildSummaryLines` | per-test console + GitHub step-summary table |

## A reporter — thin adapter

Each published reporter is just two files:

- **`src/index.ts`** — a default class implementing the runner's `Reporter` interface. It wires the
  runner's lifecycle hooks to `ci-core`: resolve config + commit + shard on begin
  (`onBegin`/`onInit`), collect the final-attempt result per tagged test
  (`onTestEnd`/`onTestCaseResult`), then on end (`onEnd`/`onTestRunEnd`) build the request and call
  `submitAll` (or `ping` + print in dry-run), and `writeSummary`. A stable `REPORTER_NAME` constant
  feeds the idempotency identity.
- **`src/map.ts`** — the *only* runner-specific logic: `map<Runner>Status` (native status →
  `mapStatus`), `readCiKey` (read the runner's `nhf` tag), `resolveShardSuffix` (the runner's shard
  identity), and the reserved tag constant (`NHF_ANNOTATION_TYPE` / `NHF_META_KEY`).

That `index` + `map` split is what [`anatomy-of-a-reporter.md`](anatomy-of-a-reporter.md) walks you
through and what `/new-reporter` scaffolds.

## Turborepo pipeline

`turbo.json`: `build` (outputs `dist/**`), `typecheck`, and `test` all `dependsOn: ["^build"]`
(a reporter needs `ci-core` built first — Turbo orders it); `lint` and `clean` stand alone. Root
scripts (`pnpm build|test|typecheck|lint|clean`) fan out via `turbo run`.

## Relationship to `report-results`

This repo and the [`report-results`](https://github.com/nohotfix/report-results) Action are both
**producers** of the same 056 contract (see [`what-is-nohotfix.md`](what-is-nohotfix.md)). The
Action is the universal JUnit fallback for any runner; a first-party reporter is the better-DX path
for a specific runner. Both emit the identical payload, so they interoperate during a migration.
</content>
