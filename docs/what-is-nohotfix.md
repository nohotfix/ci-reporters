# What NoHotfix is, and where a reporter fits

NoHotfix is a **release Go/No-Go gate**. Before a release ships, a *run* collects the state of
every test that must pass — manual checks a human executes, and **automated tests a CI pipeline
executes**. The run is Go only when every required member has a satisfactory result. The whole
point is to make "should we ship?" an evidence-backed decision instead of a vibe.

## The return path

Automated members start a run in an `awaiting` state: the gate knows the test exists but hasn't
heard back from CI yet. Something has to **report the result back** so the gate can re-evaluate.
That return path is the **056 CI ingestion contract** (`POST /api/ci/results`): a producer sends
`{ commit, environment, results[] }`, and the server matches each result to an in-progress run by
`(ci_key, commit, environment)` and flips the member (`awaiting → passed/failed/broken/skipped`).

## Where this repo sits

```
   Customer CI job (Playwright / Vitest / …)
             │  runs the automated tests
             ▼
   ┌─────────────────────────────┐
   │  a NoHotfix reporter (here)  │   ← this repo: the producer
   │  collect → map → submit      │
   └─────────────────────────────┘
             │  POST /api/ci/results   (the 056 contract)
             ▼
   NoHotfix server → matches (ci_key, commit, environment) → drives the run's Go/No-Go gate
```

A reporter is a **producer** of that contract. It is the better-DX alternative to the two older
producers:

- **The raw path** — emit JUnit / a `[nhf:<ci_key>]` title token, then a curl/Action step POSTs it.
- **The [`report-results`](https://github.com/nohotfix/report-results) Action** — parses JUnit and
  POSTs, the universal fallback for any runner.

A first-party reporter cuts all of that: one install, one config line, one `ci_key` tag per test.
It emits the **exact same 056 payload** the older paths do, so a repo can migrate test-by-test and
even run both against the same commit + environment while it does (the server converges them).

## Why "reporter", not "server"

The reporter is a **stateless producer**: it observes a run's outcomes, submits once, prints an
honest disposition, and exits. It holds no durable state and makes no gate decision — the server
owns all of that. That framing is why the reporter is small, why it must never red-fail the
customer's build (see [`resilience.md`](resilience.md)), and why the ingestion contract is
mirrored-and-linked here rather than owned here (see [`ingestion-contract.md`](ingestion-contract.md)).
</content>
