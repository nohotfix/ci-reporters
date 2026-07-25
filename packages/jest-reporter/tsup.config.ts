import { defineConfig } from 'tsup';

export default defineConfig({
  // Two entries: the Node-side reporter (`.`) and the worker-side tag helper (`./globals`).
  // Both run in Node (Jest workers are Node processes), but `globals` deliberately imports only the
  // dependency-free bridge — never `ci-core` — so a test file that tags never pulls in the transport.
  entry: ['src/index.ts', 'src/globals.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  // Bundle the private shared core INTO the reporter (customers install one package).
  noExternal: [/@nohotfix\/ci-core/],
  // Never bundle the runner — it is the consumer's peer dependency (we only use its types).
  external: ['jest'],
});
