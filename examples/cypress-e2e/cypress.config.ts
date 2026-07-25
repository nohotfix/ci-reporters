import { defineConfig } from 'cypress';
import { setupNoHotfix } from '@nohotfix/cypress-reporter';

// The reporter under test is wired exactly as a customer would wire it — one line in
// setupNodeEvents. All of NoHotfix comes from env (NOHOTFIX_INGEST_TOKEN / _ENVIRONMENT / _COMMIT /
// _API_URL). The specific ci_key to report comes from NHF_E2E_CI_KEY (set by the E2E workflow) —
// forwarded into Cypress.env here so the browser-side spec can read it.
export default defineConfig({
  e2e: {
    supportFile: false,
    specPattern: 'cypress/e2e/**/*.cy.ts',
    setupNodeEvents(on, config) {
      setupNoHotfix(on, config);
      config.env = { ...config.env, NHF_E2E_CI_KEY: process.env.NHF_E2E_CI_KEY ?? '' };
      return config;
    },
  },
});
