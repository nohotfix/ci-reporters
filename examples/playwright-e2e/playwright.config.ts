import { defineConfig } from '@playwright/test';

// The reporter under test is wired exactly as a customer would wire it — one line in the reporter
// array. All of NoHotfix comes from env: NOHOTFIX_INGEST_TOKEN / _ENVIRONMENT / _COMMIT / _API_URL,
// and the specific ci_key to report comes from NHF_E2E_CI_KEY (set by the E2E workflow).
export default defineConfig({
  testDir: './tests',
  reporter: [['list'], ['@nohotfix/playwright-reporter']],
});
