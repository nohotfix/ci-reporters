# /new-reporter `<runner>`

Scaffold a complete `packages/<runner>-reporter`, mirroring the shipped `vitest-reporter` /
`playwright-reporter` shape, then leave the runner-specific glue to fill in. `$ARGUMENTS` =
`<runner>` (e.g. `cypress`, `jest`). Work from
[`docs/anatomy-of-a-reporter.md`](../../docs/anatomy-of-a-reporter.md) — it explains every piece;
this command produces the skeleton for it.

> Everything runner-agnostic is reused from `@nohotfix/ci-core`. Only `src/index.ts` and
> `src/map.ts` hold runner-specific code. Copy the closest shipped reporter and re-wire the runner
> bits — do not re-implement transport/idempotency/config/commit/summary.

## What it creates

`packages/<runner>-reporter/`:

- **`package.json`** — mirror `vitest-reporter/package.json`:
  - `name: "@nohotfix/<runner>-reporter"`, `version: "0.1.0"`, `type: "module"`,
    `license: "MIT"`, `engines.node: ">=20"`, `files: ["dist", "README.md"]`.
  - dual `exports` + `main`/`module`/`types` pointing at `dist/`.
  - `scripts`: `build: "tsup"`, `typecheck: "tsc --noEmit"`, `test: "vitest run"`,
    `lint: "prettier --check \"src/**/*.ts\""`, `clean: "rm -rf dist .turbo"`.
  - `peerDependencies`: `{ "<runner>": ">=<min>" }`  ← the runner, never bundled.
  - `dependencies`: `{ "@nohotfix/ci-core": "workspace:*" }`  ← bundled in by tsup.
  - `devDependencies`: `{ "<runner>": "^<recent>" }`.
  - `publishConfig`: `{ "access": "public", "provenance": true }`.
- **`tsup.config.ts`** — copy an existing one; keep `noExternal: [/@nohotfix\/ci-core/]`; set
  `external: ['<runner>', /* any import subpaths you use */]`. (esm+cjs, dts, clean, sourcemap,
  target `node20`.)
- **`tsconfig.json`** — `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "rootDir":
  "src", "outDir": "dist" }, "include": ["src"] }`.
- **`vitest.config.ts`** — `{ test: { environment: 'node', include: ['src/**/*.test.ts'] } }`.
- **`src/map.ts`** — the glue (STUB the runner-specific bodies):
  - the reserved tag constant (`NHF_ANNOTATION_TYPE` or `NHF_META_KEY`, pick the runner's native
    per-test tagging mechanism);
  - `map<Runner>Status(nativeState): EmittableCiStatus` via `mapStatus` (unknown → `broken`);
  - `readCiKey(...): string | null` (trim; first non-empty; untagged → null);
  - `resolveShardSuffix(env, config?): string` (`<RUNNER>_SHARD_INDEX` → parsed `--shard` → `'0'`).
- **`src/index.ts`** — the reporter class implementing `<runner>`'s `Reporter` interface, copied
  from the closest shipped reporter with hook names re-wired: `const REPORTER_NAME = '<runner>'`; a
  constructor taking `ReporterOptions` + test hooks; on-begin → `resolveShardSuffix` +
  `resolveConfig` + `resolveCommit`; per-test → `readCiKey` + keep final attempt; on-end → build
  results, dry-run `ping`+print or `submitAll({ identity: { reporterName: REPORTER_NAME,
  shardSuffix } })` + `writeSummary`, catching `CiTransportError` → `setExitCode(1)`.
- **`src/__tests__/`** — skeletons for `map.test.ts`, `reporter.test.ts`, `contract.test.ts` (the
  contract test loads the vendored `ci-core` fixture — see the `reporter-testing` skill).
- **`README.md`** — mirror `vitest-reporter/README.md` (install · one-line config · two secrets ·
  tag a test · dry-run · shards · config table · migration note).
- **`CHANGELOG.md`** — start with `## 0.1.0 (unreleased)`, mirroring the shipped reporters.

`examples/<runner>-app/`:

- `package.json` (`@nohotfix/example-<runner>-app`, `private`, dep `@nohotfix/<runner>-reporter:
  "workspace:*"`, devDep the runner, a `dogfood` script), the runner config with the one reporter
  line, `tests/checkout.<ext>` with two `nhf`-tagged tests + one untagged, and a README (mirror
  `examples/vitest-app/README.md`).

Release wiring:

- Add `"@nohotfix/<runner>-reporter"` to the `workflow_dispatch` `options:` list in
  `.github/workflows/release.yml` (the release matrix).

## Steps the command runs

1. Create the files above (copy the closest shipped reporter; stub the runner-specific glue).
2. `pnpm install` to link the new workspace package.
3. Fill in the runner-specific `map.ts` / `index.ts` bodies (or hand off to the
   `reporter-integration-architect` agent) — the scaffold leaves clear `TODO(<runner>)` markers.
4. **End by running [`/verify`](verify.md)** (`pnpm turbo run build typecheck lint test`) — the
   scaffold must build, typecheck, lint, and pass its skeleton tests before you're done.
</content>
