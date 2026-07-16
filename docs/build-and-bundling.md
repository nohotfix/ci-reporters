# Build & bundling (tsup)

Every package builds with **tsup**. The build has one job beyond compiling: **fold the private
`@nohotfix/ci-core` into each reporter's bundle while keeping the runner external**, so a customer
installs exactly one package with zero runtime dependencies.

## The tsup config

Each reporter's `tsup.config.ts` (see `packages/vitest-reporter/tsup.config.ts`):

```ts
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],   // dual — customers on ESM or CJS both work
  dts: true,                // emit .d.ts types
  clean: true,              // wipe dist/ each build
  sourcemap: true,
  target: 'node20',
  noExternal: [/@nohotfix\/ci-core/],  // ← bundle the private core INTO the reporter
  external: ['vitest', 'vitest/node', 'vitest/config', 'vitest/reporters'], // ← runner stays a peer
});
```

Output per package (git-ignored — never committed):

```
dist/index.js   (ESM)   dist/index.cjs   (CJS)   dist/index.d.ts   (types)   + .map files
```

`package.json` points at all three via `exports` (`types` / `import` / `require`) and
`main`/`module`/`types`; `files: ["dist", "README.md"]` is what gets published.

## Two rules that matter

1. **`ci-core` is `noExternal` (bundled in).** It is `private: true` and never published — the only
   way its code reaches a customer is inside a reporter's bundle. Match `@nohotfix/ci-core` in
   `noExternal` so tsup inlines it. There is no `ci-core` version for a customer to resolve.

2. **The runner is `external` (never bundled).** The runner (`@playwright/test`, `vitest`, and its
   subpaths) is a **peerDependency** the customer already has. Bundling it would duplicate the
   runner, break its singletons, and bloat the package. List the runner **and every import subpath
   you use** in `external` (Vitest needs `vitest`, `vitest/node`, etc.). `ci-core` itself is
   pure Node — it adds no third-party deps to bundle.

## `ci-core`'s own build

`packages/ci-core/tsup.config.ts` is the same minus the externals (it has no runner and nothing to
keep external). It emits `dist/` too, but that output is only consumed at **build time** by the
reporters (Turbo's `^build` ordering builds it first); it is never published.

## Verifying a bundle

`pnpm build` then check `dist/` exists for each package; `pnpm typecheck` validates the emitted
types compile. `/verify` runs the whole gate. If a customer reports a missing/duplicated runner,
the cause is almost always a runner import subpath missing from `external`.
</content>
