// The whole NoHotfix integration: one line added to the reporters array.
// Token + environment come from NOHOTFIX_INGEST_TOKEN / NOHOTFIX_ENVIRONMENT (CI secrets);
// the commit is auto-resolved from GITHUB_SHA (or set NOHOTFIX_COMMIT). Use NOHOTFIX_DRY_RUN=true
// to validate without touching any run's gate.
/** @type {import('jest').Config} */
module.exports = {
  reporters: ['default', '@nohotfix/jest-reporter'],
};
