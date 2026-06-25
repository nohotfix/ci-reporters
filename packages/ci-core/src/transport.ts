import { buildIdempotencyKey, chunk, MAX_RESULTS_PER_CALL } from './idempotency.js';
import type { IngestionDisposition, PingResult, ReporterConfig, SubmitRequest } from './types.js';

export type FetchLike = typeof fetch;

/**
 * A "fail clearly" error (FR-012). Thrown ONLY for genuine setup/reporter errors the
 * customer must fix — never for transient/server-side conditions (those warn, see below).
 */
export class CiTransportError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'malformed',
  ) {
    super(message);
    this.name = 'CiTransportError';
  }
}

/**
 * The outcome of a submission attempt. `submitted` carries the server disposition; `warned`
 * means a transient/ignorable condition occurred (5xx/network/429) — the job must NOT fail.
 * Fail-clearly conditions are thrown as {@link CiTransportError}, not returned.
 */
export type SubmitOutcome =
  | { status: 'submitted'; disposition: IngestionDisposition }
  | { status: 'warned'; warning: string };

export interface SubmitOptions {
  /** Sent as the `Idempotency-Key` header when present (wired in US3). */
  idempotencyKey?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  /** Retry count for 5xx/network (US2). Default 3. */
  retries?: number;
  /** Back-off in ms for a given attempt index (0-based). US2. Default 1s/2s/4s. */
  backoffMs?: (attempt: number) => number;
  /** Injectable sleep, for fast tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_BACKOFF = (attempt: number): number => 1000 * 2 ** attempt;
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Submit one chunk of results to the 056 ingestion endpoint, resilient by default (D8).
 *
 * The split is by *who can fix it*:
 *   - 2xx                 → `submitted` (disposition)
 *   - 401 / 403           → throw `CiTransportError('auth')`      (fail clearly — bad token)
 *   - 400                 → throw `CiTransportError('malformed')` (fail clearly — reporter bug)
 *   - 429                 → `warned`                              (rate limited; do not fail)
 *   - 5xx / network error → retry with back-off (1s/2s/4s), then `warned` (do not fail)
 *   - other 4xx           → `warned`                              (unexpected; do not fail)
 *
 * Only the two fail-clearly cases throw; everything else warns so the customer's test job
 * never goes red because of NoHotfix (FR-011 / FR-012).
 */
export async function submitResults(
  config: ReporterConfig,
  request: SubmitRequest,
  options: SubmitOptions = {},
): Promise<SubmitOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 3;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF;
  const sleep = options.sleep ?? defaultSleep;

  const url = `${config.apiUrl}/api/ci/results`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.token}`,
    'content-type': 'application/json',
  };
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  const body = JSON.stringify(request);

  let lastWarning = `NoHotfix submission to ${url} did not complete.`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(url, { method: 'POST', headers, body });
    } catch (error) {
      lastWarning = `network error reaching ${url}: ${String(error)}`;
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return { status: 'warned', warning: `${lastWarning} (after ${retries} retries)` };
    }

    if (response.ok) {
      const disposition = (await response.json()) as IngestionDisposition;
      return { status: 'submitted', disposition };
    }

    if (response.status === 401 || response.status === 403) {
      throw new CiTransportError(
        `NoHotfix rejected the ingest token (HTTP ${response.status}). ` +
          'Check NOHOTFIX_INGEST_TOKEN — it may be invalid, revoked, or for a different org.',
        'auth',
      );
    }
    if (response.status === 400) {
      throw new CiTransportError(
        'NoHotfix rejected the payload as malformed (HTTP 400). This is a reporter bug — ' +
          'please report it. No results were applied.',
        'malformed',
      );
    }
    if (response.status === 429) {
      return {
        status: 'warned',
        warning: 'NoHotfix rate-limited the submission (HTTP 429); results were not applied.',
      };
    }
    if (response.status >= 500) {
      lastWarning = `NoHotfix returned HTTP ${response.status}; results were not applied.`;
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return { status: 'warned', warning: `${lastWarning} (after ${retries} retries)` };
    }
    // Any other unexpected 4xx — do not fail the job.
    return {
      status: 'warned',
      warning: `NoHotfix returned an unexpected HTTP ${response.status}; results were not applied.`,
    };
  }

  /* c8 ignore next */
  return { status: 'warned', warning: lastWarning };
}

// Re-exported so US2's hardening keeps a single source for the defaults.
export { DEFAULT_BACKOFF, defaultSleep };

/** Identity used to derive each chunk's content-addressed idempotency key (FR-010). */
export interface IdempotencyIdentity {
  reporterName: string;
  shardSuffix: string;
}

export interface SubmitAllOptions extends Omit<SubmitOptions, 'idempotencyKey'> {
  identity?: IdempotencyIdentity;
}

export interface SubmitAllResult {
  /** Number of chunks the server accepted. */
  submittedChunks: number;
  /** Warnings from any warned chunk (transient — the job is not failed). */
  warnings: string[];
  /** Merged disposition across all submitted chunks (null if every chunk warned). */
  disposition: IngestionDisposition | null;
}

function mergeDisposition(
  into: IngestionDisposition | null,
  next: IngestionDisposition,
): IngestionDisposition {
  if (!into) return { ...next, ignored: [...next.ignored] };
  return {
    commit: into.commit,
    environment: into.environment,
    accepted: into.accepted + next.accepted,
    ignored: [...into.ignored, ...next.ignored],
    appliedToLibrary: into.appliedToLibrary + next.appliedToLibrary,
    appliedToOpenRuns: into.appliedToOpenRuns + next.appliedToOpenRuns,
  };
}

/**
 * Submit ALL of a run's results, chunking beyond the server's per-call cap (FR-009 / D9)
 * and attaching a per-chunk content-addressed idempotency key (FR-010). Fail-clearly errors
 * (401/403/400) propagate; transient chunk failures are collected as warnings.
 */
export async function submitAll(
  config: ReporterConfig,
  request: SubmitRequest,
  options: SubmitAllOptions = {},
): Promise<SubmitAllResult> {
  const { identity, ...submitOptions } = options;
  const chunks = chunk(request.results, MAX_RESULTS_PER_CALL);
  const multiChunk = chunks.length > 1;

  let disposition: IngestionDisposition | null = null;
  let submittedChunks = 0;
  const warnings: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const idempotencyKey = identity
      ? buildIdempotencyKey({
          commit: request.commit,
          environment: request.environment,
          reporterName: identity.reporterName,
          shardSuffix: identity.shardSuffix,
          chunkIndex: multiChunk ? i : undefined,
        })
      : undefined;

    const outcome = await submitResults(
      config,
      { commit: request.commit, environment: request.environment, results: chunks[i]! },
      { ...submitOptions, idempotencyKey },
    );

    if (outcome.status === 'submitted') {
      submittedChunks++;
      disposition = mergeDisposition(disposition, outcome.disposition);
    } else {
      warnings.push(outcome.warning);
    }
  }

  return { submittedChunks, warnings, disposition };
}

export interface PingOutcome {
  ok: boolean;
  message: string;
}

/**
 * Validate the ingest credential against the read-only ping endpoint (GET /api/ci/ping),
 * used by dry-run (FR-015). Never throws — it returns a verdict the reporter renders.
 */
export async function ping(
  config: ReporterConfig,
  options: { fetchImpl?: FetchLike; ciKey?: string } = {},
): Promise<PingOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL(`${config.apiUrl}/api/ci/ping`);
  if (options.ciKey) url.searchParams.set('ciKey', options.ciKey);

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${config.token}` },
    });
  } catch (error) {
    return { ok: false, message: `could not reach ${url.toString()}: ${String(error)}` };
  }

  if (response.ok) {
    const data = (await response.json()) as PingResult;
    let message = `credential valid (org: ${data.org?.name ?? 'unknown'})`;
    if (data.ciKey) {
      message += data.ciKey.recognized
        ? `; ci_key "${data.ciKey.value}" is recognized`
        : `; ci_key "${data.ciKey.value}" is NOT recognized`;
    }
    return { ok: true, message };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      message: `credential REJECTED (HTTP ${response.status}) — check NOHOTFIX_INGEST_TOKEN.`,
    };
  }
  return { ok: false, message: `ping returned HTTP ${response.status}.` };
}
