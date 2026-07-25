import {
  buildSummaryLines,
  CiTransportError,
  ping,
  resolveCommit,
  resolveConfig,
  submitAll,
  unresolvedCommitMessage,
  writeSummary,
  type CiResultInput,
  type CommitResolution,
  type EmittableCiStatus,
  type FetchLike,
  type ReporterConfig,
  type ReporterOptions,
  type SubmitRequest,
} from '@nohotfix/ci-core';
import {
  mapCypressStatus,
  NHF_TASK_NAME,
  readCiKey,
  resolveShardSuffix,
  resultKey,
  type NhfTagPayload,
} from './map.js';

const REPORTER_NAME = 'cypress';

/** Minimal logger surface (injectable for tests). */
export interface ReporterLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Internal test hooks — NOT part of the public contract. */
interface ReporterTestHooks {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  logger?: ReporterLogger;
  /** How the reporter signals a fail-clearly error. Defaults to setting `process.exitCode`. */
  setExitCode?: (code: number) => void;
  /** Transport retry count (defaults to the transport's own default). Test-only. */
  retries?: number;
  /** Injectable sleep so resilience tests don't incur real back-off. Test-only. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable GitHub step-summary file append. Test-only. */
  appendFile?: (path: string, data: string) => void;
}

interface Collected {
  ciKey: string;
  status: EmittableCiStatus;
  durationMs: number;
}

// ── Structural Cypress `after:run` result shapes ───────────────────────────────
// Only the fields the reporter reads, kept structural (not a hard `cypress` type import) so the
// reporter stays independently testable and resilient to Cypress result-shape additions.

/**
 * One attempt of a test (Cypress records one entry per try, including retries). Cypress's public
 * `after:run` payload exposes only `state` per attempt — no per-attempt timing — so that is all we
 * model.
 */
export interface CypressAttempt {
  state?: string;
}

/** One test's result inside a spec run. `title` is the full Mocha title path. */
export interface CypressTestResult {
  title: string[];
  state: string;
  duration?: number;
  attempts?: CypressAttempt[];
}

/** One spec's run within the overall run. */
export interface CypressSpecRun {
  /** The spec's relative path — scopes each test so same-titled tests across specs don't collide. */
  spec?: { relative?: string };
  tests?: CypressTestResult[];
}

/** The `after:run` payload for a run that executed — the subset the reporter reads. */
export interface CypressRunResultLike {
  runs?: CypressSpecRun[];
}

/**
 * The `after:run` payload when Cypress could not run at all (no specs matched, fatal setup error).
 * Cypress passes this shape instead of {@link CypressRunResultLike}; the reporter warns and submits
 * nothing rather than masking it as "no tagged tests".
 */
export interface CypressFailedRunLike {
  status: 'failed';
  failures?: number;
  message?: string;
}

/** Either `after:run` payload Cypress may deliver. */
export type CypressAfterRun = CypressRunResultLike | CypressFailedRunLike;

/** The subset of Cypress's plugin-event registrar (`on`) the plugin uses. */
export interface CypressPluginEvents {
  (event: 'task', tasks: Record<string, (arg: unknown) => unknown>): void;
  (event: 'after:run', fn: (results: CypressAfterRun) => void | Promise<void>): void;
}

const consoleLogger: ReporterLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

function extractDurationMs(test: CypressTestResult): number {
  // `duration` is the real, required top-level field on Cypress's after:run test result.
  const value = test.duration;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

/**
 * NoHotfix Cypress reporter. Collects each `nhf`-tagged test's result during the run and submits
 * them once at `after:run` to the 056 ingestion contract — driving the run's Go/No-Go gate with no
 * curl step, JUnit file, or title token. Mirrors the shipped Playwright/Vitest reporters over the
 * shared, unchanged `@nohotfix/ci-core`.
 *
 * Wire it via {@link setupNoHotfix}; this class is exported mainly so it is fully unit-driveable.
 */
export default class NoHotfixReporter {
  private readonly options: ReporterOptions;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: FetchLike;
  private readonly log: ReporterLogger;
  private readonly setExitCode: (code: number) => void;
  private readonly retries?: number;
  private readonly sleep?: (ms: number) => Promise<void>;
  private readonly appendFile?: (path: string, data: string) => void;

  /** `ci_key` per test, keyed by spec + title path — populated over `cy.task` during the run. */
  private readonly registry = new Map<string, string>();
  /** Final result per test, keyed by spec + title path (guards against a double-emit). */
  private readonly collected = new Map<string, Collected>();
  private config?: ReporterConfig;
  private configError?: Error;
  private commit: CommitResolution = { commit: null, source: 'none' };
  private shardSuffix = '0';

  constructor(options: ReporterOptions & ReporterTestHooks = {}) {
    const { env, fetchImpl, logger, setExitCode, retries, sleep, appendFile, ...publicOptions } =
      options;
    this.options = publicOptions;
    this.env = env ?? process.env;
    this.fetchImpl = fetchImpl ?? fetch;
    this.log = logger ?? consoleLogger;
    this.setExitCode = setExitCode ?? ((code) => void (process.exitCode = code));
    this.retries = retries;
    this.sleep = sleep;
    this.appendFile = appendFile;
  }

  private summaryDeps() {
    return {
      info: (m: string) => this.log.info(m),
      warn: (m: string) => this.log.warn(m),
      env: this.env,
      appendFile: this.appendFile,
    };
  }

  /** Resolve shard identity, config, and commit before the run — mirrors the other reporters. */
  onRunBegin(): void {
    this.shardSuffix = resolveShardSuffix(this.env);
    try {
      this.config = resolveConfig(this.env, this.options);
      this.commit = resolveCommit(this.env, this.config.commitOverride);
    } catch (error) {
      this.configError = error instanceof Error ? error : new Error(String(error));
      // Surface it before any test work is wasted. Not a build failure — the exit-code contract
      // reserves hard-fails for 401/403/400.
      this.log.error(`[NoHotfix] ${this.configError.message}`);
    }
  }

  /** Bind a test (by spec + title path) to its `ci_key`. Invoked by the reserved `cy.task` handler. */
  recordCiKey(payload: NhfTagPayload): void {
    if (!Array.isArray(payload?.titlePath) || typeof payload?.ciKey !== 'string') return;
    this.registry.set(resultKey(payload.specId, payload.titlePath), payload.ciKey);
  }

  async onRunEnd(runResult: CypressAfterRun): Promise<void> {
    if (this.configError) return; // already surfaced in onRunBegin; never fails the build.
    const config = this.config;
    if (!config) return;

    // Cypress could not run at all (no specs matched, fatal setup error) — its failed-run payload is
    // the only one carrying a top-level `status`. Warn, don't mask it as "nothing to submit". Still
    // never red-fails: the exit-code contract reserves that for 401/403/400.
    if ('status' in runResult) {
      this.log.warn(
        `[NoHotfix] Cypress did not run (${runResult.message ?? 'no specs executed'}) — nothing submitted.`,
      );
      return;
    }

    this.collect(runResult);

    const results = this.buildResults();
    if (results.length === 0) {
      this.log.info('[NoHotfix] No nhf-tagged tests found — nothing to submit.');
      return;
    }

    if (!this.commit.commit) {
      this.log.warn(`[NoHotfix] ${unresolvedCommitMessage()}`);
      return;
    }

    const request: SubmitRequest = {
      commit: this.commit.commit,
      environment: config.environment,
      results,
    };

    // Dry-run: validate the credential, print the would-be payload, POST nothing.
    if (config.dryRun) {
      const pingOutcome = await ping(config, {
        fetchImpl: this.fetchImpl,
        ciKey: results[0]?.ciKey,
      });
      writeSummary(
        {
          apiUrl: config.apiUrl,
          dryRun: true,
          lines: buildSummaryLines(results, null, { pending: true }),
          warnings: [],
          ping: pingOutcome,
        },
        this.summaryDeps(),
      );
      return;
    }

    try {
      const result = await submitAll(config, request, {
        fetchImpl: this.fetchImpl,
        retries: this.retries,
        sleep: this.sleep,
        identity: { reporterName: REPORTER_NAME, shardSuffix: this.shardSuffix },
      });
      writeSummary(
        {
          apiUrl: config.apiUrl,
          dryRun: false,
          // Only render the per-test table when the server confirmed a disposition; if every
          // chunk warned (disposition null), just surface the warnings — never claim "accepted".
          lines: result.disposition ? buildSummaryLines(results, result.disposition) : [],
          warnings: result.warnings,
        },
        this.summaryDeps(),
      );
    } catch (error) {
      if (error instanceof CiTransportError) {
        // Fail clearly: a genuine setup/reporter error (401/403/400). This is the ONLY path that
        // alters the exit code — warn cases never do (the exit-code contract).
        this.log.error(`[NoHotfix] ${error.message}`);
        this.setExitCode(1);
        return;
      }
      throw error;
    }
  }

  private collect(runResult: CypressRunResultLike): void {
    for (const run of runResult.runs ?? []) {
      const specId = run.spec?.relative;
      for (const test of run.tests ?? []) {
        const titlePath = Array.isArray(test.title) ? test.title : [];
        const ciKey = readCiKey(specId, titlePath, this.registry);
        if (!ciKey) continue; // untagged tests are omitted.
        this.collected.set(resultKey(specId, titlePath), {
          ciKey,
          status: mapCypressStatus(test.state),
          durationMs: extractDurationMs(test),
        });
      }
    }
  }

  private buildResults(): CiResultInput[] {
    const results: CiResultInput[] = [];
    for (const item of this.collected.values()) {
      const result: CiResultInput = { ciKey: item.ciKey, status: item.status };
      if (item.durationMs > 0) result.durationMs = item.durationMs;
      // `reportedAt` is intentionally omitted: Cypress's `after:run` payload exposes no per-test
      // timestamp, and we never emit a value at a precision the runner didn't give us.
      results.push(result);
    }
    return results;
  }
}

/**
 * Wire the NoHotfix reporter into a Cypress project. Call it from `setupNodeEvents` — it registers
 * the reserved `nhf` tag task (browser → Node bridge) and the `after:run` submit hook:
 *
 * @example
 * // cypress.config.ts
 * import { defineConfig } from 'cypress';
 * import { setupNoHotfix } from '@nohotfix/cypress-reporter';
 *
 * export default defineConfig({
 *   e2e: {
 *     setupNodeEvents(on, config) {
 *       setupNoHotfix(on, config);
 *       return config;
 *     },
 *   },
 * });
 */
export function setupNoHotfix<Config>(
  on: CypressPluginEvents,
  config: Config,
  options: ReporterOptions & ReporterTestHooks = {},
): Config {
  const reporter = new NoHotfixReporter(options);
  reporter.onRunBegin();
  on('task', {
    [NHF_TASK_NAME]: (arg: unknown) => {
      reporter.recordCiKey(arg as NhfTagPayload);
      return null; // a Cypress task must return a (serializable) value.
    },
  });
  on('after:run', (results) => reporter.onRunEnd(results));
  return config;
}

export {
  mapCypressStatus,
  readCiKey,
  resolveShardSuffix,
  resultKey,
  NHF_TASK_NAME,
} from './map.js';
export type { NhfTagPayload } from './map.js';
