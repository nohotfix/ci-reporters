// Worker-side (test context) tag helper. Imported from '@nohotfix/jest-reporter/globals'.
// Runs inside a Jest test, reads the test's own identity from `expect.getState()`, and hands the
// `ci_key` to the main-process reporter over the file bridge. Keeps to the dependency-free bridge —
// never imports `@nohotfix/ci-core`.
import { writeTag } from './bridge.js';

// Jest injects `expect` as a global (the default `injectGlobals: true`); its state carries the
// running test's identity. Declared minimally so this package keeps zero type coupling to Jest.
interface JestExpectState {
  currentTestName?: string;
  // For `test.concurrent`, Jest exposes a *separately scoped* name (AsyncLocalStorage-backed) —
  // `currentTestName` is a single shared field set by the sequential per-test dispatch, so a
  // concurrent test's body (which runs interleaved) can read a stale value. Prefer this when present.
  currentConcurrentTestName?: () => string | undefined;
  testPath?: string;
}
interface JestExpect {
  getState(): JestExpectState;
}

/**
 * Bind the current Jest test to its NoHotfix `ci_key`. Call it inside a test (or a `beforeEach`); it
 * records the key against the test's `expect.getState()` identity and ships it to the reporter over
 * the file bridge. A test with no `nhf.tag` is omitted from submission, so you can migrate
 * test-by-test.
 *
 * Requires `injectGlobals: true` (the Jest default) so `expect` is a global; outside a running test
 * (or if the state has no name/path) it is a safe no-op.
 *
 * @example
 * import { nhf } from '@nohotfix/jest-reporter/globals';
 *
 * test('checkout completes for a new user', () => {
 *   nhf.tag('checkout.new-user.complete'); // the ci_key from your NoHotfix library
 *   expect(checkout()).toBe('ok');
 * });
 */
export function tag(ciKey: string): void {
  const expectGlobal = (globalThis as { expect?: JestExpect }).expect;
  const state = expectGlobal?.getState?.();
  // Concurrent-safe name first; fall back to the sequential field.
  const testName = state?.currentConcurrentTestName?.() ?? state?.currentTestName;
  const testPath = state?.testPath;
  if (!testName || !testPath) return; // outside a test / injectGlobals:false → no-op.
  writeTag({ testPath, testName, ciKey });
}

/** The customer-facing tagging helper. `nhf.tag('<ci_key>')` — no Jest import needed. */
export const nhf = { tag } as const;
