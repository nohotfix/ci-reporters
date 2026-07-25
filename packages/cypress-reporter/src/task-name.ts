/**
 * The reserved Cypress task name that bridges a test's `ci_key` from the browser (spec) context
 * to the Node reporter. `nhf.tag('<ci_key>')` invokes `cy.task(NHF_TASK_NAME, …)`; the plugin
 * registers a handler for it in `setupNoHotfix`.
 *
 * Lives in its own dependency-free module ON PURPOSE: `support.ts` (browser) imports it without
 * pulling in `@nohotfix/ci-core` (Node `fetch`/`crypto`), and `map.ts` re-exports it for the
 * Node side. Both contexts MUST reference the same string.
 */
export const NHF_TASK_NAME = 'nhf:recordCiKey';

/** The payload `nhf.tag` sends over `cy.task` and the plugin's task handler receives. */
export interface NhfTagPayload {
  /**
   * The current spec's relative path (`Cypress.spec.relative`). Scopes the tag to its spec so two
   * tests that share a title path across different spec files never collide — Cypress keeps one
   * Node plugin process for the whole `cypress run`, so title paths alone are not unique.
   */
  specId?: string;
  /** The current test's full title path (`Cypress.currentTest.titlePath`). */
  titlePath: string[];
  /** The NoHotfix `ci_key` to bind this test to. */
  ciKey: string;
}
