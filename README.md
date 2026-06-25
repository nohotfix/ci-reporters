# NoHotfix CI reporters

First-party test reporters that report your CI results into [NoHotfix](https://nohotfix.com)
to drive a release run's Go/No-Go gate — **better-DX producers of the existing CI ingestion
contract**. Install one package, add one config line, annotate each automated test with its
`ci_key`. No curl step, no JUnit file, no title token. **Purely additive** — the raw
JUnit-token path and the [`nohotfix/report-results`](https://github.com/nohotfix/report-results)
GitHub Action remain a permanent fallback.

## Packages

| Package | Published | Purpose |
|---|---|---|
| [`@nohotfix/playwright-reporter`](./packages/playwright-reporter) | ✅ npm | The Playwright reporter (increment 1) |
| `@nohotfix/ci-core` | ❌ private | Shared transport/status/idempotency/summary core, **bundled** into each reporter |

Follow-on increments (separate releases): **Vitest → Cypress → Jest** reporters, reusing
`ci-core`.

## Design principles

- **Resilient by default** — NoHotfix problems never red-fail the customer's test job; only a
  bad token (401/403) or a malformed payload (400) fails clearly.
- **Zero runtime dependencies** — Node 20 built-in `fetch`/`crypto`; `@playwright/test` is a peer.
- **Shard-safe** — content-addressed idempotency keys; re-running a shard is a no-op.
- **Honest** — a per-test disposition to the console and the GitHub step summary; a dry-run
  that validates and prints without writing.

## Develop

```bash
pnpm install
pnpm build       # tsup, dual ESM+CJS + types
pnpm typecheck
pnpm lint
pnpm test        # Vitest (incl. the 056 payload contract test)
```

The `examples/playwright-app` is the dogfood — an annotated suite that drives a real run.

## Release

Human-initiated, build-on-release, OIDC trusted publishing + npm provenance — no committed
`dist`, no stored `NPM_TOKEN`, no AI in the release path. See `.github/workflows/release.yml`.

## License

MIT
