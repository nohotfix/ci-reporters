# The ingestion contract (thin mirror)

> **Canonical source: feature 056 in `nohotfix.com`.** This doc is a *mirror* for reading — just
> enough to work in this repo. It is **not** authoritative and must never present itself as such.
> The one source of truth is `nohotfix.com` feature **056 — CI result ingestion**
> (`packages/shared/src/schemas/integrations.ts`). Drift is caught by [`/contract-check`](../.claude/commands/contract-check.md),
> which reconciles this repo's vendored fixture against 056.

## The vendored oracle

This repo does **not** copy the full 056 schema. It vendors a small slice as a **test fixture**:

```
packages/ci-core/src/__tests__/fixtures/server-schema.ts
```

That file mirrors the request/response Zod schemas (`IngestResultsRequestSchema`,
`IngestionDispositionSchema`, …) and is the oracle for the **contract test**: every payload a
reporter emits must validate against `IngestResultsRequestSchema`. `zod` is a test-only
devDependency — it is never in the reporter's runtime. If 056 changes, update the fixture
*deliberately* and re-run the contract test (that is exactly what `/contract-check` walks you
through).

## The shape (mirror level)

**Submit — `POST /api/ci/results`**, body:

```
{ commit, environment, results: [ { ciKey, status, durationMs?, reportedAt? }, … ] }
```

- `commit`, `environment` — 1–200 chars each (required).
- `results` — 1–2000 items (the reporter chunks beyond 2000; see `ci-core/idempotency.ts`).
- `ciKey` — 1–200 chars; `status` — one of the server enum (below); `durationMs` — int ≥ 0;
  `reportedAt` — ISO-8601. Both optional.
- Header `Idempotency-Key` — content-addressed per chunk/shard (see [`conventions.md`](conventions.md)
  and `ci-core/idempotency.ts`), so re-running a shard is a server-side no-op.

**Server status enum**: `passed · failed · broken · not_executed · skipped`. A reporter only ever
*emits* `passed | failed | broken | skipped`; `not_executed` is a **server-side inference** (a run
member that never got a report) — the reporter never sends it.

## Exact-match

The server matches each result to an in-progress run by an **exact match on
`(ci_key, commit, environment)`**. All three must line up — this is why the reporter never invents
a commit and never defaults the environment (see [`conventions.md`](conventions.md)); a wrong value
silently matches nothing.

## Disposition (the 200 response)

An honest per-submission accounting the reporter renders back to the developer:

```
{ commit, environment, accepted, ignored: [ { ciKey, reason } ], appliedToLibrary, appliedToOpenRuns }
```

- `accepted` — results the server applied.
- `ignored` — results dropped, each with a `reason` (`unknown_ci_key`, `archived_test`, …). The
  reason type is read **loosely** (a future server reason must not break parsing).
- `appliedToLibrary` / `appliedToOpenRuns` — how many landed on the library vs open runs.

`ci-core/summary.ts` turns this into the per-test console + GitHub step-summary table.

## Ping (dry-run)

**`GET /api/ci/ping`** — a read-only credential check used by dry-run (`NOHOTFIX_DRY_RUN=true`).
Returns `{ ok, org, ciKey? }` and, when a `ciKey` query param is passed, whether that key is
recognized. Dry-run validates the token and prints the would-be payload but **POSTs nothing** —
no run is touched.

## Keeping it honest

Because a stale contract copy is the single most dangerous doc to duplicate, the only defenses
against drift are (a) the vendored fixture is a **test** (a red test is drift), and (b)
`/contract-check` diffs it against 056 before releases. Read those, not this file, when
correctness matters.
</content>
