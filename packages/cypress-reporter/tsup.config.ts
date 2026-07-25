import { defineConfig } from 'tsup';

export default defineConfig({
  // Two entries: the Node-side plugin (`.`) and the browser-side tag helper (`./support`).
  // They MUST stay separate bundles — `support` runs in the spec/browser context and must never
  // pull `ci-core` (Node `fetch`/`crypto`) into Cypress's bundler.
  entry: ['src/index.ts', 'src/support.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  // Bundle the private shared core INTO the reporter (customers install one package).
  noExternal: [/@nohotfix\/ci-core/],
  // Never bundle the runner — it is the consumer's peer dependency.
  external: ['cypress'],
});
