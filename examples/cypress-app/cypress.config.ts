import { defineConfig } from 'cypress';
import { setupNoHotfix } from '@nohotfix/cypress-reporter';

// The whole NoHotfix integration: one line inside setupNodeEvents.
// Token + environment come from NOHOTFIX_INGEST_TOKEN / NOHOTFIX_ENVIRONMENT (CI secrets);
// the commit is auto-resolved from GITHUB_SHA (or set NOHOTFIX_COMMIT). Use NOHOTFIX_DRY_RUN=true
// to validate without touching any run's gate.
export default defineConfig({
  e2e: {
    supportFile: false,
    specPattern: 'cypress/e2e/**/*.cy.ts',
    setupNodeEvents(on, config) {
      setupNoHotfix(on, config);
      return config;
    },
  },
});
