# Resilience: NoHotfix never red-fails the build

The load-bearing promise of every reporter: **a NoHotfix problem never turns the customer's test
job red.** A reporter runs *inside* someone's CI; if our service hiccups, their build must not.
Only a genuine setup error the customer must fix ever fails clearly.

This is implemented once, in `ci-core/transport.ts` (`submitResults`), and every reporter inherits
it. The split is by **who can fix it**.

## Warn-vs-fail matrix

| Condition | Behavior | Why |
|---|---|---|
| `2xx` | **submitted** (render the disposition) | success |
| Unknown / archived `ci_key` | **ignore** (server drops it; shown as `ignored` in the disposition) | not an error — a renamed/archived test |
| `429` (rate limited) | **warn** — job stays green | transient; results just weren't applied |
| `5xx` / network error | **retry** with back-off (1s/2s/4s, 3 retries), then **warn** | transient server/infra |
| Other unexpected `4xx` | **warn** — job stays green | unexpected; don't punish the build |
| `401` / `403` (bad/rejected token) | **fail clearly** (`CiTransportError('auth')`) | real setup error — a bad, revoked, or wrong-org token |
| `400` (malformed payload) | **fail clearly** (`CiTransportError('malformed')`) | a reporter bug — should be reported |

Only the two **fail-clearly** cases throw. Everything else warns. A warned submission prints
`… The test job is not affected.` and returns; the reporter's exit-code contract reserves the hard
fail exclusively for `CiTransportError` (401/403/400) — see each reporter's `onEnd`/`onTestRunEnd`,
which calls `setExitCode(1)` **only** in that catch.

## The exit-code contract

- **Config error** (missing token/environment) → surfaced with `log.error` in `onBegin`/`onInit`,
  *before* tests run, but **does not** fail the build (the exit-code hard-fail is reserved for the
  transport auth/malformed cases).
- **Unresolved commit** → warn + skip submission (see [`conventions.md`](conventions.md)).
- **Warned transport** (429/5xx/network/other) → warn, exit unchanged.
- **`CiTransportError`** (401/403/400) → `log.error` + `setExitCode(1)`. The single red path.

## Note for other producers

The [`report-results`](https://github.com/nohotfix/report-results) Action shares this matrix and
adds one case: a **missing JUnit file = fail** (a misconfiguration the user must fix). A
first-party reporter has no such case — it reads results from the runner in-process, so there is
no file to be missing. The shared substance is identical: NoHotfix problems warn; the customer's
own setup errors fail clearly.
</content>
