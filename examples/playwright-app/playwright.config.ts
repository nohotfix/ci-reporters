import { defineConfig } from '@playwright/test';

// The whole NoHotfix integration: one line added to the reporter array.
// Token + environment come from NOHOTFIX_INGEST_TOKEN / NOHOTFIX_ENVIRONMENT (CI secrets);
// the commit is auto-resolved from GITHUB_SHA (or set NOHOTFIX_COMMIT). Use NOHOTFIX_DRY_RUN=true
// to validate without touching any run's gate.
export default defineConfig({
  testDir: './tests',
  reporter: [['list'], ['@nohotfix/playwright-reporter']],
});
