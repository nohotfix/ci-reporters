// Browser-side (spec context) tag helper. Imported from '@nohotfix/cypress-reporter/support'.
// This file MUST stay free of any `@nohotfix/ci-core` import — it is bundled by Cypress into the
// browser, where Node's `fetch`/`crypto` do not belong. It only bridges the `ci_key` to the Node
// reporter over the reserved `cy.task`.
import { NHF_TASK_NAME, type NhfTagPayload } from './task-name.js';

// Minimal ambient shapes for the Cypress globals available in a spec. Declared locally (not via
// `@types/cypress`) so this package keeps zero type coupling to a specific Cypress version.
interface CyGlobal {
  task(event: string, arg: unknown, options?: { log?: boolean }): unknown;
}
interface CypressGlobal {
  currentTest?: { titlePath?: string[] };
  spec?: { relative?: string };
}
declare const cy: CyGlobal;
declare const Cypress: CypressGlobal;

/**
 * Bind the current Cypress test to its NoHotfix `ci_key`. Call it inside a test (or a `beforeEach`);
 * it records the key against the current test's full title path and ships it to the Node reporter
 * over the reserved `nhf` task. A test with no `nhf.tag` is omitted from submission, so you can
 * migrate test-by-test.
 *
 * @example
 * import { nhf } from '@nohotfix/cypress-reporter/support';
 *
 * it('checkout completes for a new user', () => {
 *   nhf.tag('checkout.new-user.complete'); // the ci_key from your NoHotfix library
 *   // ...assertions
 * });
 */
export function tag(ciKey: string): void {
  const titlePath = Cypress.currentTest?.titlePath ?? [];
  const specId = Cypress.spec?.relative;
  const payload: NhfTagPayload = { specId, titlePath, ciKey };
  // `log: false` keeps the bridge out of the Cypress command log.
  cy.task(NHF_TASK_NAME, payload, { log: false });
}

/** The customer-facing tagging helper. `nhf.tag('<ci_key>')` — no Cypress internals needed. */
export const nhf = { tag } as const;

export { NHF_TASK_NAME } from './task-name.js';
export type { NhfTagPayload } from './task-name.js';
