# /verify

Run the repo's full green gate — build + typecheck + lint + test across every package. Use this
after scaffolding a reporter, changing any package, or before a release. `$ARGUMENTS` is ignored.

## Steps

```bash
pnpm install
pnpm turbo run build typecheck lint test
```

- `build` — tsup, dual ESM+CJS+types, for `ci-core` and each reporter (Turbo builds `ci-core`
  first via `^build`).
- `typecheck` — `tsc --noEmit` per package.
- `lint` — `prettier --check "src/**/*.ts"`.
- `test` — Vitest per package, including each reporter's `contract.test.ts` (the 056 payload
  oracle), the fault-injection tests (unreachable API stays green), and the `map`/unit tests.

## Success

All four tasks pass. A green run proves the docs/tooling didn't touch runtime behavior and that a
new scaffold is wired correctly. If `lint` fails, run `pnpm exec prettier --write "packages/**/src/**/*.ts"`.
If `test` fails on a contract test, the 056 mirror may have drifted — run
[`/contract-check`](contract-check.md).
</content>
