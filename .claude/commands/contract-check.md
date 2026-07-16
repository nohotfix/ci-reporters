# /contract-check

Reconcile this repo's vendored 056 server-schema fixture against the **canonical** contract in
`nohotfix.com`, and report any drift. Run on demand and before every release — it is not wired into
CI (it needs `nohotfix.com` at hand, and the repo is rate-limited). `$ARGUMENTS` is ignored.

See [`docs/ingestion-contract.md`](../../docs/ingestion-contract.md); the
`contract-drift-auditor` agent owns the judgment.

## The two files

| Role | Path |
|---|---|
| **Vendored oracle** (this repo) | `packages/ci-core/src/__tests__/fixtures/server-schema.ts` |
| **Canonical source** (nohotfix.com) | `packages/shared/src/schemas/integrations.ts` (feature 056) |

## Steps

1. **Fast signal — run the contract tests.** A red contract test *is* drift:
   ```bash
   pnpm --filter @nohotfix/ci-core test
   pnpm turbo run test
   ```
   Each reporter's `contract.test.ts` validates a real emitted `SubmitRequest` against the fixture's
   `IngestResultsRequestSchema`.

2. **Diff the schemas.** With a checkout of `nohotfix.com` available, compare the vendored fixture to
   the canonical file, focusing on the ingest-side schemas:
   - `IngestResultsRequestSchema` (commit/environment `min(1).max(200)`, `results` `min(1).max(2000)`)
   - `CiResultInputSchema` (`ciKey` `min(1).max(200)`, `status`, optional `reportedAt` datetime /
     `durationMs` int nonnegative)
   - `CiStatusSchema` enum (`passed·failed·broken·not_executed·skipped`)
   - `IngestIgnoredReasonSchema` (`unknown_ci_key·archived_test`)
   - `IngestionDispositionSchema`
   ```bash
   # if nohotfix.com is a sibling checkout:
   diff <(sed -n '/CiStatusSchema/,/IngestionDispositionSchema/p' \
           ../nohotfix.com/packages/shared/src/schemas/integrations.ts) \
        packages/ci-core/src/__tests__/fixtures/server-schema.ts || true
   ```
   (The canonical file also holds ingestion-log / token / attribution schemas the reporter does not
   produce — ignore those; the fixture intentionally mirrors only the ingest request/response/ping.)

3. **Also check the runtime model** `packages/ci-core/src/types.ts` tracks the same shape.

## Report

- **No drift** → say so; the mirror is current.
- **Drift** → list exactly what changed (field, constraint, enum value), then **update the fixture
  (and `types.ts`) deliberately** to match 056 and re-run step 1. Never loosen a test to force a
  pass. The fixture header comment says: *"If the server contract changes, update this file
  deliberately and re-run the contract test."* — that is this command.
</content>
