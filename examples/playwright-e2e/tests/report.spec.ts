import { expect, test } from '@playwright/test';

/**
 * Live E2E harness for the playwright-reporter.
 *
 * This is NOT a unit test — it exists to be run by the `nohotfix.com` E2E workflow, which boots the
 * API, seeds the "Acme Pipeline — CI Driven" org, discovers an in-progress run's automated `ci_key`
 * (+ its environment/commit), and invokes this suite with:
 *   NOHOTFIX_API_URL, NOHOTFIX_INGEST_TOKEN, NOHOTFIX_ENVIRONMENT, NOHOTFIX_COMMIT, NHF_E2E_CI_KEY
 * The reporter (wired in playwright.config.ts) then submits this test's result to the live run; the
 * workflow asserts the member flipped in the database.
 *
 * Skipped unless NHF_E2E_CI_KEY is set — so normal CI / a plain `pnpm test` never touches a server
 * (and the test uses no `page`, so it needs no browser binary).
 */
const ciKey = process.env.NHF_E2E_CI_KEY?.trim();

test(
  'reports a seeded automated result to a live NoHotfix run',
  // Bind this test to the target run's automated member via the reserved `nhf` annotation — the
  // whole integration. When unset the description is empty, so the reporter reads it as untagged.
  { annotation: { type: 'nhf', description: ciKey ?? '' } },
  async () => {
    test.skip(!ciKey, 'NHF_E2E_CI_KEY not set — live E2E only');
    // The assertion that matters (did the member flip? did the gate re-evaluate?) is made by the
    // workflow against the database after the run — this test just has to pass so the reporter maps
    // it to `passed` and submits it.
    expect(ciKey).toBeTruthy();
  },
);
