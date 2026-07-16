# Docs — `@nohotfix/ci-reporters`

Everything needed to work in this repo, self-contained. Start at
[`../CLAUDE.md`](../CLAUDE.md) for orientation; this is the index.

## Where do I look for X?

| I want to… | Read |
|---|---|
| Understand NoHotfix + where a reporter fits | [`what-is-nohotfix.md`](what-is-nohotfix.md) |
| **Add a reporter for a new runner** (the headline task) | [`anatomy-of-a-reporter.md`](anatomy-of-a-reporter.md) → then `/new-reporter <runner>` |
| Understand the repo layout / `ci-core` vs reporters | [`architecture.md`](architecture.md) |
| Understand tsup bundling (`ci-core` in, runner out) | [`build-and-bundling.md`](build-and-bundling.md) |
| Read the ingestion contract (mirror → 056) | [`ingestion-contract.md`](ingestion-contract.md) → guarded by `/contract-check` |
| The `ci_key` tag, status mapping, commit/env rules | [`conventions.md`](conventions.md) |
| Why NoHotfix never fails the build (warn-vs-fail) | [`resilience.md`](resilience.md) |
| How the reporters are tested | [`testing.md`](testing.md) → then the `reporter-testing` skill |
| How releases work (OIDC, provenance, no token) | [`releasing.md`](releasing.md) → then `/release` |

## Shared principles (also documented in `report-results`)

These are duplicated + tailored into both producer repos so each stands alone:
[`what-is-nohotfix`](what-is-nohotfix.md) · [`ingestion-contract`](ingestion-contract.md) (the
sole doc that links out, to 056) · [`conventions`](conventions.md) · [`resilience`](resilience.md)
· [`testing`](testing.md) · [`releasing`](releasing.md).

## `.claude/` tooling

- **Agents** — `reporter-integration-architect` (add/maintain a reporter),
  `contract-drift-auditor` (contract drift vs 056).
- **Skill** — `reporter-testing` (the test recipe).
- **Commands** — `/new-reporter <runner>`, `/verify`, `/contract-check`,
  `/release <package> <version>`.
</content>
