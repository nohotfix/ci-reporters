# Releasing & publishing philosophy

The workflow is [`.github/workflows/release.yml`](../.github/workflows/release.yml). Read that
file — this doc explains the *why*; the [`/release`](../.claude/commands/release.md) command is
the step-by-step runbook.

## Five non-negotiables

1. **Human-initiated.** A release only happens when a maintainer publishes a GitHub Release (or
   manually runs the workflow via `workflow_dispatch`). Nothing publishes on a plain push/merge.
2. **OIDC trusted publishing + npm provenance.** The job runs with `id-token: write` and publishes
   with `--provenance`; npm mints the package's provenance attestation from the GitHub OIDC token.
   Configure the npm package's **Trusted Publisher** to this repo + workflow first.
3. **No stored `NPM_TOKEN`.** There is no long-lived npm secret anywhere. Trust comes from OIDC, so
   there is no token to leak or rotate.
4. **No AI in the release path.** The publish workflow is deterministic and human-triggered; no
   agent runs during a release. Agents help you *prepare* a release (bump versions, write the
   changelog, run `/contract-check`) but never *perform* the publish.
5. **No committed build artifact.** `dist/` is git-ignored. The bundle is **built on the release
   commit** inside the workflow (`pnpm build`) and published from there — never checked in.

## What the workflow does (mirror)

```
on: release published  |  workflow_dispatch (choose the package)
permissions: contents: read, id-token: write          # OIDC + provenance
corepack enable → setup-node@20 (registry npmjs, cache pnpm)
pnpm install --frozen-lockfile
pnpm build            # tsup: the bundle is produced HERE, on the release commit
pnpm typecheck
pnpm test             # incl. the 056 contract test — a drifted contract blocks the release
pnpm --filter "<package>" publish --no-git-checks --provenance --access public
```

- **`ci-core` is bundled, not published.** Only the customer-facing reporter is published; tsup
  `noExternal` folds `ci-core` into its bundle. There is no separate `ci-core` release.
- The `workflow_dispatch` **package choice list** is the release matrix. When you add a reporter,
  add its package to that `options:` list (the `/new-reporter` scaffold does this).
- Versioning: each reporter versions independently. Stay on `0.x` until dogfooded against a live
  run, then `1.0.0` (see each package's CHANGELOG).

## Per-package, independent

Because each reporter is its own npm package with its own version and CHANGELOG, a release targets
**one package + one version** (`/release <package> <version>`). Bump the package's `version` and
`CHANGELOG.md`, tag it, publish that one package. `ci-core`'s bundled-in changes ride along in
whichever reporter you cut.
</content>
