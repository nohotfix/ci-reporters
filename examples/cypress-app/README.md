# Dogfood — Cypress app using `@nohotfix/cypress-reporter`

The canonical acceptance for the Cypress reporter (the same bar the Playwright/Vitest dogfoods
set): an `nhf`-tagged Cypress suite that reports into a **live** NoHotfix and flips a real
automated member / drives the run's Go/No-Go gate — with **no curl step and no JUnit file**.

## Run it (the live dogfood)

```bash
# 1. Seed a NoHotfix automated test with ci_key `checkout.new-user.complete`
#    and start an in-progress run on a known commit + environment.
# 2. Mint an ingest token (Settings → Integrations).

export NOHOTFIX_INGEST_TOKEN=nhf_...           # the minted token
export NOHOTFIX_ENVIRONMENT=production         # must match the run's environment
export NOHOTFIX_COMMIT=<the run's commit>      # or rely on GITHUB_SHA in CI
export NOHOTFIX_API_URL=http://localhost:3001  # point at your NoHotfix API

pnpm --filter @nohotfix/example-cypress-app dogfood
```

Expected: the suite runs, the reporter POSTs once at `after:run`, and the automated member for
`checkout.new-user.complete` flips `awaiting → passed`, re-evaluating the gate. The console
(and the GitHub step summary in Actions) shows the disposition.

> Requires `cypress run` (the reporter submits from `after:run`, which does not fire in
> `cypress open`), and a browser available on the machine.

## Validate without touching the gate

```bash
NOHOTFIX_DRY_RUN=true pnpm --filter @nohotfix/example-cypress-app dogfood
# Validates the token via GET /api/ci/ping, prints the would-be payload, POSTs nothing.
```

## Sharded?

```bash
CYPRESS_SHARD_INDEX=1 pnpm --filter @nohotfix/example-cypress-app dogfood --spec "cypress/e2e/**/*.cy.ts"
```

Shards converge to one de-duplicated result set and a shard re-run is a no-op — the shard index
folds into the submission's `Idempotency-Key`.
