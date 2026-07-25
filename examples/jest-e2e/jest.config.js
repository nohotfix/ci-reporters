// The reporter under test is wired exactly as a customer would wire it — one line.
// All of NoHotfix comes from env: NOHOTFIX_INGEST_TOKEN / _ENVIRONMENT / _COMMIT / _API_URL,
// and the specific ci_key to report comes from NHF_E2E_CI_KEY (set by the E2E workflow).
/** @type {import('jest').Config} */
module.exports = {
  reporters: ['default', '@nohotfix/jest-reporter'],
};
