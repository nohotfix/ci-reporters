// In-memory type model for NoHotfix CI reporters. These mirror the shipped 056
// ingestion contract (POST /api/ci/results) exactly — see contracts/server-payload.md
// in the spec repo. The reporter is a stateless producer; all durable state is server-side.

/**
 * The server result enum (fixed). `flaky` is intentionally absent (deferred from the
 * 056 MVP enum). NOTE: the reporter only ever *emits* `passed | failed | broken | skipped`;
 * `not_executed` is a server-side inference (a member in the run set that got no report).
 */
export type CiStatus = 'passed' | 'failed' | 'broken' | 'not_executed' | 'skipped';

/** The statuses a reporter can actually produce from an observed runner outcome. */
export type EmittableCiStatus = Exclude<CiStatus, 'not_executed'>;

/** One test's outcome to submit. */
export interface CiResultInput {
  /** The NoHotfix library identifier, from the `nhf` annotation. 1–200 chars. */
  ciKey: string;
  status: CiStatus;
  /** Optional test duration in milliseconds (integer ≥ 0). */
  durationMs?: number;
  /** Optional ISO-8601 time the result was produced. */
  reportedAt?: string;
}

/** The POST body for one submission (one chunk). */
export interface SubmitRequest {
  /** Resolved commit SHA under test. 1–200 chars. */
  commit: string;
  /** The run's environment (matched server-side against in-progress runs). 1–200 chars. */
  environment: string;
  /** 1–2000 results (the reporter chunks beyond 2000). */
  results: CiResultInput[];
}

export type IngestIgnoredReason = 'unknown_ci_key' | 'archived_test';

/** The server's 200 response — rendered to the developer as the disposition. */
export interface IngestionDisposition {
  commit: string;
  environment: string;
  accepted: number;
  // `reason` is typed loosely (string) so a future server reason never breaks parsing.
  ignored: Array<{ ciKey: string; reason: IngestIgnoredReason | string }>;
  appliedToLibrary: number;
  appliedToOpenRuns: number;
}

/** The read-only ping (GET /api/ci/ping) response used by dry-run validation. */
export interface PingResult {
  ok: true;
  org: { slug: string; name: string };
  ciKey?: { value: string; recognized: boolean };
}

/** Reporter options, as passed in the runner config. Env vars take priority over these. */
export interface ReporterOptions {
  token?: string;
  environment?: string;
  apiUrl?: string;
  commit?: string;
  dryRun?: boolean;
}

/** Fully-resolved configuration (env > options), after required-field validation. */
export interface ReporterConfig {
  token: string;
  environment: string;
  apiUrl: string;
  /**
   * Explicit commit override (NOHOTFIX_COMMIT / options.commit) or null. The final commit
   * is `commitOverride ?? resolveCommit(env)` — resolved by the reporter, not here, so config
   * stays free of CI-provider knowledge and is independently testable.
   */
  commitOverride: string | null;
  dryRun: boolean;
}
