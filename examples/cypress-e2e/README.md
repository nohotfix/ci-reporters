# Live E2E — `@nohotfix/e2e-cypress-live`

Env-driven harness the **nohotfix.com** E2E workflow drives to prove the `cypress-reporter` against a
real NoHotfix run end-to-end (real token, real gate flip) — the Cypress analogue of
[`examples/vitest-e2e`](../vitest-e2e) and [`examples/playwright-e2e`](../playwright-e2e).

Unlike those two it is **not** wired to `pnpm test`. `cypress run` always needs the Cypress binary +
a browser (Electron), so booting it on every unit-CI run would be wasteful and fragile. It exposes an
`e2e` script instead, invoked explicitly by the pipeline:

```bash
NHF_E2E_CI_KEY=<seeded ci_key> \
NOHOTFIX_INGEST_TOKEN=... NOHOTFIX_ENVIRONMENT=... NOHOTFIX_COMMIT=... NOHOTFIX_API_URL=... \
pnpm --filter @nohotfix/e2e-cypress-live e2e
```

The config forwards `NHF_E2E_CI_KEY` into `Cypress.env`; the spec tags itself with it via
`nhf.tag(...)`, and the reporter submits at `after:run`. With `NHF_E2E_CI_KEY` unset the single test
skips (an accidental local `cypress run` submits nothing).
