# Dogfood — Playwright app using `@nohotfix/playwright-reporter`

This is the canonical acceptance for the reporter (the same bar 065 used): an annotated
Playwright suite that reports into a **live** NoHotfix and flips a real automated member /
drives the run's Go/No-Go gate — with **no curl step and no JUnit file**.

It supersedes the curl/JUnit-based `ci-ingestion-fixtures` example in the `nohotfix.com` repo.

## Run it (T023 — the live dogfood)

```bash
# 1. Seed a NoHotfix automated test with ci_key `checkout.new-user.complete`
#    and start an in-progress run on a known commit + environment.
# 2. Mint an ingest token (Settings → Integrations).

export NOHOTFIX_INGEST_TOKEN=nhf_...           # the minted token
export NOHOTFIX_ENVIRONMENT=production         # must match the run's environment
export NOHOTFIX_COMMIT=<the run's commit>      # or rely on GITHUB_SHA in CI
export NOHOTFIX_API_URL=http://localhost:3001  # point at your NoHotfix API

pnpm --filter @nohotfix/example-playwright-app dogfood
```

Expected: the suite runs, the reporter POSTs once at the end, and the automated member for
`checkout.new-user.complete` flips `awaiting → passed`, re-evaluating the gate. The console
(and the GitHub step summary in Actions) shows the disposition.

## Validate without touching the gate

```bash
NOHOTFIX_DRY_RUN=true pnpm --filter @nohotfix/example-playwright-app dogfood
# Validates the token via GET /api/ci/ping, prints the would-be payload, POSTs nothing.
```
