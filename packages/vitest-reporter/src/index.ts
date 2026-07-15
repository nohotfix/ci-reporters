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
import type { Reporter, TestCase, Vitest } from 'vitest/node';
import { mapVitestStatus, NHF_META_KEY, readCiKey, resolveShardSuffix } from './map.js';

const REPORTER_NAME = 'vitest';

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
  retry: number;
  reportedAt?: string;
}

const consoleLogger: ReporterLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

/**
 * NoHotfix Vitest reporter. Collects each `nhf`-tagged test's result during the run and submits
 * them once at the end to the 056 ingestion contract — driving the run's Go/No-Go gate with no
 * curl step, JUnit file, or title token. Mirrors the shipped Playwright reporter over the shared,
 * unchanged `@nohotfix/ci-core`.
 */
export default class NoHotfixReporter implements Reporter {
  private readonly options: ReporterOptions;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: FetchLike;
  private readonly log: ReporterLogger;
  private readonly setExitCode: (code: number) => void;
  private readonly retries?: number;
  private readonly sleep?: (ms: number) => Promise<void>;
  private readonly appendFile?: (path: string, data: string) => void;

  /** Final-attempt result per test, keyed by test id (handles retries → last attempt). */
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

  onInit(vitest?: Vitest): void {
    this.shardSuffix = resolveShardSuffix(this.env, vitest?.config);
    try {
      this.config = resolveConfig(this.env, this.options);
      this.commit = resolveCommit(this.env, this.config.commitOverride);
    } catch (error) {
      this.configError = error instanceof Error ? error : new Error(String(error));
      // Surface it before any test work is wasted (FR-007). Not a build failure — the
      // exit-code contract reserves hard-fails for 401/403/400.
      this.log.error(`[NoHotfix] ${this.configError.message}`);
    }
  }

  onTestCaseResult(testCase: TestCase): void {
    const ciKey = readCiKey(testCase);
    if (!ciKey) return; // FR-003: tests without an nhfKey are omitted.

    const diagnostic = testCase.diagnostic();
    const retry = diagnostic?.retryCount ?? 0;

    const previous = this.collected.get(testCase.id);
    // Keep the final attempt: guard against any double-fire; the highest retry wins.
    if (previous && previous.retry > retry) return;

    const durationMs = diagnostic?.duration;
    this.collected.set(testCase.id, {
      ciKey,
      status: mapVitestStatus(testCase.result().state),
      durationMs: typeof durationMs === 'number' ? Math.max(0, Math.round(durationMs)) : 0,
      retry,
      reportedAt:
        typeof diagnostic?.startTime === 'number'
          ? new Date(diagnostic.startTime).toISOString()
          : undefined,
    });
  }

  async onTestRunEnd(): Promise<void> {
    if (this.configError) return; // already surfaced in onInit; never fails the build.
    const config = this.config;
    if (!config) return;

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

    // Dry-run (FR-010): validate the credential, print the would-be payload, POST nothing.
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
        // Fail clearly (FR-012): a genuine setup/reporter error (401/403/400). This is the
        // ONLY path that alters the exit code — warn cases never do (the exit-code contract).
        this.log.error(`[NoHotfix] ${error.message}`);
        this.setExitCode(1);
        return;
      }
      throw error;
    }
  }

  private buildResults(): CiResultInput[] {
    const results: CiResultInput[] = [];
    for (const item of this.collected.values()) {
      const result: CiResultInput = { ciKey: item.ciKey, status: item.status };
      if (item.durationMs > 0) result.durationMs = item.durationMs;
      if (item.reportedAt) result.reportedAt = item.reportedAt;
      results.push(result);
    }
    return results;
  }
}

/**
 * The minimal structural shape `nhf.tag` writes into — a subset of Vitest's test context exposing
 * its mutable `task.meta` object. Structural (not a hard Vitest import) so customer test files never
 * import Vitest internals just to tag a test.
 */
export interface NhfTagContext {
  task: { meta: object };
}

/**
 * Bind the current test to its NoHotfix `ci_key` by writing the reserved `nhfKey` task metadata.
 * The reporter reads the same key back via `testCase.meta()` in `onTestCaseResult`.
 *
 * @example
 * test('checkout completes', (ctx) => {
 *   nhf.tag(ctx, 'checkout.new-user.complete');
 * });
 */
export function tag(ctx: NhfTagContext, ciKey: string): void {
  (ctx.task.meta as Record<string, unknown>)[NHF_META_KEY] = ciKey;
}

/** The customer-facing tagging helper. `nhf.tag(ctx, '<ci_key>')` — no Vitest import needed. */
export const nhf = { tag } as const;

export { mapVitestStatus, readCiKey, resolveShardSuffix, NHF_META_KEY } from './map.js';
