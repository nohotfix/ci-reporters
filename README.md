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
| [`@nohotfix/vitest-reporter`](./packages/vitest-reporter) | ✅ npm | The Vitest v3 reporter (increment 2) |
| [`@nohotfix/cypress-reporter`](./packages/cypress-reporter) | ✅ npm | The Cypress reporter (increment 3) |
| [`@nohotfix/jest-reporter`](./packages/jest-reporter) | ✅ npm | The Jest v29+ reporter (increment 4) |
| `@nohotfix/ci-core` | ❌ private | Shared transport/status/idempotency/summary core, **bundled** into each reporter |

## Reporter status

Build order is **Playwright → Vitest → Cypress → Jest** — each new reporter is a thin runner
adapter over the shared `ci-core` (transport, status mapping, commit/env resolution, idempotency,
summary). Until a runner has a first-party reporter, its results still flow via the raw
JUnit-token path or the [`report-results`](https://github.com/nohotfix/report-results) Action — so
this table is about **DX, not capability**.

| Runner | Package | Status | How a test binds its `ci_key` |
|---|---|---|---|
| **Playwright** | `@nohotfix/playwright-reporter` | ✅ **Shipped** | `test(..., { annotation: { type: 'nhf', description: '<ci_key>' } }, …)` |
| **Vitest** | `@nohotfix/vitest-reporter` | 🕛 **Next** | `testCase.meta()` or a `nhf.tag(ctx, '<ci_key>')` helper · peer-dep `vitest>=3` (`onTestCaseResult`/`onTestRunEnd`) |
| **Cypress** | `@nohotfix/cypress-reporter` | 🕛 Planned | `this.nhfKey` in `before()`, or `cy.task('nhf:setKey', '<ci_key>')` (Mocha reporter) |
| **Jest** | `@nohotfix/jest-reporter` | 🕛 Planned | an `nhfTest('<ci_key>', …)` wrapper, or `jest-metadata` read in `onTestResult` |

Legend: ✅ Shipped · 🕛 Next / Planned. Per-runner annotation designs live in the platform repo's
`docs/development/research/ci-reporters.md` (Phase C–F) and `ci-ingestion-dx.md` (§4).

## Design principles

- **Resilient by default** — NoHotfix problems never red-fail the customer's test job; only a
  bad token (401/403) or a malformed payload (400) fails clearly.
- **Zero runtime dependencies** — Node 20 built-in `fetch`/`crypto`; `@playwright/test` is a peer.
- **Shard-safe** — content-addressed idempotency keys; re-running a shard is a no-op.
- **Honest** — a per-test disposition to the console and the GitHub step summary; a dry-run
  that validates and prints without writing.

## Docs & tooling for contributors

This repo is self-contained: [`CLAUDE.md`](./CLAUDE.md) orients you and [`docs/`](./docs) holds
the full contributor guide — start at [`docs/README.md`](./docs/README.md). The headline task,
**adding a reporter for a new runner**, is [`docs/anatomy-of-a-reporter.md`](./docs/anatomy-of-a-reporter.md)
plus the `/new-reporter <runner>` command. Claude Code agents/skills/commands live in
[`.claude/`](./.claude).

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
