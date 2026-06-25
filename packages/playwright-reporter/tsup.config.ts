import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  // Bundle the private shared core INTO the reporter (customers install one package).
  noExternal: [/@nohotfix\/ci-core/],
  // Never bundle the runner — it is the consumer's peer dependency.
  external: ['@playwright/test'],
});
