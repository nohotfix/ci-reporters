# CLAUDE.md — `@nohotfix/ci-reporters`

Orientation for a contributor or an AI agent working in this repo. **This repo is
self-contained**: everything you need to extend it lives here in `docs/` + `.claude/`. You
never need to open `nohotfix.com` — the one exception is the ingestion contract, which links
to feature 056 as its canonical source (see `docs/ingestion-contract.md`).

## What this repo is

First-party **test reporters** that report a customer's CI results into NoHotfix so they drive
a release run's Go/No-Go gate — the better-DX producers of the existing 056 CI ingestion
contract. Install one package, add one config line, tag each automated test with its `ci_key`;
no curl step, no JUnit file, no `[nhf:<ci_key>]` title token. The reporter is a **stateless
producer** — all durable state is server-side. It is **purely additive**: the raw JUnit path
and the [`nohotfix/report-results`](https://github.com/nohotfix/report-results) Action remain a
permanent fallback.

For the product thesis (the Go/No-Go gate and where a producer fits), read
[`docs/what-is-nohotfix.md`](docs/what-is-nohotfix.md).

## Package map

pnpm + Turborepo monorepo. Packages live in `packages/*`, dogfood apps in `examples/*`.

| Package | Published? | Role |
|---|---|---|
| `@nohotfix/ci-core` | **No — private, bundled** | The ~70% shared core (status · commit · config · idempotency · transport · summary). Bundled *into* each reporter via tsup `noExternal`; never published, so there is no public `ci-core` API to version. |
| `@nohotfix/playwright-reporter` | Yes (npm) | Reporter increment 1 — Playwright. |
| `@nohotfix/vitest-reporter` | Yes (npm) | Reporter increment 2 — Vitest v3. |

Each published reporter is a thin adapter: `src/index.ts` (the runner's `Reporter` class) +
`src/map.ts` (runner-specific glue: `map<Runner>Status`, `readCiKey`, `resolveShardSuffix`,
the reserved `nhf` key/annotation). Everything runner-agnostic is reused from `ci-core`.

Follow-on reporters (Cypress, Jest, …) reuse `ci-core` the same way. **Adding one is the
headline self-service task** — see [`docs/anatomy-of-a-reporter.md`](docs/anatomy-of-a-reporter.md),
the key expansion guide, and the `/new-reporter <runner>` command.

## House rules

- **Toolchain**: pnpm (`packageManager: pnpm@9`) + Turborepo + tsup (dual ESM+CJS+types).
  Node ≥ 20. TypeScript `strict` + `verbatimModuleSyntax` (`tsconfig.base.json`).
- **Zero runtime dependencies** — Node 20 built-in `fetch`/`crypto` only. The runner is a
  **peerDependency** (never bundled); `@nohotfix/ci-core` is a `workspace:*` dep that tsup
  bundles in. `zod` is a **test-only** devDependency (the 056 contract oracle).
- **Resilient by default** — a NoHotfix problem never red-fails the customer's test job. Only a
  bad token (401/403) or a malformed payload (400) fails clearly. See `docs/resilience.md`.
- **Never silently `passed`** — an unknown/ambiguous runner outcome maps to `broken`, so the
  gate is never falsely satisfied. See `docs/conventions.md`.
- **Never invent a commit** — auto-detect from CI vars or `NOHOTFIX_COMMIT`; otherwise skip and
  warn. Environment is never defaulted. See `docs/conventions.md`.
- **Never commit `dist/`** — the bundle is built on release, not stored in git.

## Entry points

| Do this | Run |
|---|---|
| Build everything | `pnpm build` (`turbo run build`) |
| Typecheck | `pnpm typecheck` |
| Lint (Prettier check) | `pnpm lint` |
| Test (Vitest, incl. the 056 contract test) | `pnpm test` |
| Full green gate | `/verify` → `pnpm install` + `pnpm turbo run build typecheck lint test` |
| Add a reporter | `/new-reporter <runner>` (scaffolds `packages/<runner>-reporter`) |
| Check the contract hasn't drifted | `/contract-check` |
| Cut a release | `/release <package> <version>` |

## Where to look

Start at [`docs/README.md`](docs/README.md) — the index and "where do I look for X" table.

- **Add a reporter** → `docs/anatomy-of-a-reporter.md` (+ the `reporter-integration-architect`
  agent, `/new-reporter`).
- **Repo layout / bundling** → `docs/architecture.md`, `docs/build-and-bundling.md`.
- **The ingestion contract** → `docs/ingestion-contract.md` (thin mirror → 056; guarded by
  `/contract-check` + the `contract-drift-auditor` agent).
- **Shared principles** → `docs/conventions.md` (annotation · status · commit/env),
  `docs/resilience.md`, `docs/testing.md`, `docs/releasing.md`.
- **`.claude/` tooling** → `agents/` (reporter-integration-architect, contract-drift-auditor),
  `skills/reporter-testing`, `commands/` (new-reporter, verify, contract-check, release).
</content>
</invoke>
