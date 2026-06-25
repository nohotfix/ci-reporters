// @nohotfix/ci-core — shared, bundled-only core for NoHotfix CI reporters.
// Re-exported by each reporter; never published on its own.

export type {
  CiStatus,
  EmittableCiStatus,
  CiResultInput,
  SubmitRequest,
  IngestIgnoredReason,
  IngestionDisposition,
  PingResult,
  ReporterOptions,
  ReporterConfig,
} from './types.js';

export { resolveConfig, ReporterConfigError, DEFAULT_API_URL } from './config.js';
export { mapStatus, type RunnerOutcome } from './status.js';
export {
  resolveCommit,
  unresolvedCommitMessage,
  COMMIT_ENV_VARS,
  type CommitResolution,
} from './commit.js';
export {
  submitResults,
  submitAll,
  CiTransportError,
  type SubmitOutcome,
  type SubmitOptions,
  type SubmitAllOptions,
  type SubmitAllResult,
  type IdempotencyIdentity,
  type FetchLike,
} from './transport.js';
export {
  buildIdempotencyKey,
  chunk,
  MAX_RESULTS_PER_CALL,
  type IdempotencyParts,
} from './idempotency.js';
export { ping, type PingOutcome } from './transport.js';
export {
  writeSummary,
  buildSummaryLines,
  type SummaryLine,
  type SummaryContext,
  type SummaryDeps,
} from './summary.js';
