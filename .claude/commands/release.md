# /release `<package> <version>`

Publish one reporter to npm via the repo's real workflow
([`.github/workflows/release.yml`](../../.github/workflows/release.yml)). `$ARGUMENTS` =
`<package> <version>`, e.g. `/release @nohotfix/vitest-reporter 0.1.0`. See
[`docs/releasing.md`](../../docs/releasing.md) for the philosophy.

## Non-negotiables (encoded in the workflow)

- **Human-initiated** — you publish a GitHub Release (or run `workflow_dispatch`); nothing publishes
  on a plain push/merge.
- **OIDC trusted publishing + npm provenance** — `id-token: write` + `--provenance`; the npm
  package's Trusted Publisher must point at this repo + `release.yml`.
- **No stored `NPM_TOKEN`** — trust is OIDC; there is no long-lived npm secret.
- **No AI in the release path** — the publish is deterministic and human-triggered; agents prepare,
  they do not publish.
- **No committed `dist/`** — the bundle is built inside the workflow (`pnpm build`), never in git.

## Steps

1. **Preflight (local).**
   ```bash
   /contract-check     # the 056 mirror must be current — a drifted contract must not ship
   /verify             # pnpm install + turbo build typecheck lint test — must be green
   ```
2. **Bump the package** `<package>`: set `packages/<name>/package.json` `version` to `<version>` and
   add the `<version>` section to `packages/<name>/CHANGELOG.md` (move `unreleased` → the version;
   `0.x` until dogfooded against a live run, then `1.0.0`). Confirm `<package>` is in the
   `workflow_dispatch` `options:` list in `release.yml`.
3. **Commit + tag** on a branch, open a PR, merge to `main` (per the repo's branch flow).
4. **Publish** — create a **GitHub Release** for the tag (or run the **Release** workflow via
   `workflow_dispatch` and pick `<package>`). The workflow then, on `ubuntu-latest` with
   `id-token: write`:
   ```
   corepack enable → setup-node@20 (registry npmjs, cache pnpm)
   pnpm install --frozen-lockfile
   pnpm build          # bundle produced here, on the release commit
   pnpm typecheck
   pnpm test           # incl. the 056 contract test
   pnpm --filter "<package>" publish --no-git-checks --provenance --access public
   ```
5. **Verify** the package appears on npm with a provenance attestation. `@nohotfix/ci-core` is
   **bundled in, not published** — never publish it separately.

## Notes

- One package per release. Each reporter versions independently; `ci-core` changes ride along in
  whichever reporter you cut.
- The default `workflow_dispatch` package is `@nohotfix/playwright-reporter` — always confirm the
  choice matches `<package>`.
</content>
