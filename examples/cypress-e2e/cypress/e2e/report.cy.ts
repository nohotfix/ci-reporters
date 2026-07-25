import { nhf } from '@nohotfix/cypress-reporter/support';

/**
 * Live E2E harness for the cypress-reporter.
 *
 * This is NOT a unit test — it exists to be run by the `nohotfix.com` E2E workflow, which boots the
 * API, seeds the "Acme Pipeline — CI Driven" org, discovers an in-progress run's automated `ci_key`
 * (+ its environment/commit), and invokes `cypress run` with NHF_E2E_CI_KEY (forwarded into
 * `Cypress.env` by cypress.config.ts) plus the reporter env. The reporter submits this test's result
 * at `after:run`; the workflow asserts the member flipped in the database.
 *
 * Skipped unless NHF_E2E_CI_KEY is set — so an accidental local `cypress run` never touches a server.
 */
const ciKey = (Cypress.env('NHF_E2E_CI_KEY') as string | undefined)?.trim();

(ciKey ? it : it.skip)('reports a seeded automated result to a live NoHotfix run', () => {
  // Bind this test to the target run's automated member — the whole integration.
  nhf.tag(ciKey!);
  // The assertion that matters (did the member flip? did the gate re-evaluate?) is made by the
  // workflow against the database after the run — this test just has to pass so the reporter maps
  // it to `passed` and submits it.
  expect(ciKey).to.be.ok;
});
