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
import type { Reporter } from '@jest/reporters';
import type { AggregatedResult, AssertionResult, TestResult } from '@jest/test-result';
import { clearTags, readTags, tagDir, type TagRecord } from './bridge.js';
import {
  mapJestStatus,
  readCiKey,
  resolveShardSuffix,
  resultKey,
  type JestShardConfig,
} from './map.js';

const REPORTER_NAME = 'jest';

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
  /** Override the bridge temp dir (test-only). */
  tagDir?: string;
  /** Read the tag records (test-only — defaults to reading the bridge files). */
  readTags?: () => TagRecord[];
  /** Clear the tag records (test-only — defaults to removing the bridge dir). */
  clearTags?: () => void;
}

interface Collected {
  ciKey: string;
  status: EmittableCiStatus;
  durationMs: number;
}

// ── Structural Jest result shapes ──────────────────────────────────────────────
// Only the fields the reporter reads, kept structural (not a hard `jest` type import) so the
// reporter stays independently testable and resilient to result-shape additions.

/** One assertion (`it`/`test`) result. `fullName` is the full "describe … it" name. */
export interface JestAssertionResult {
  fullName: string;
  status: string;
  duration?: number | null;
}

/** One spec file's result. */
export interface JestFileResult {
  testFilePath: string;
  testResults?: JestAssertionResult[];
}

/** The `onRunComplete` aggregate — the subset the reporter reads. */
export interface JestAggregatedResult {
  testResults?: JestFileResult[];
}

/** The subset of Jest's `GlobalConfig` the reporter reads (passed as the reporter's 1st arg). */
export type JestGlobalConfig = JestShardConfig;

// Compile-time drift guards: the structural shapes above MUST stay a readable subset of Jest's real
// result types. If a future Jest renames/retypes a field we read, `Assert<…>` collapses to a type
// error here rather than a silent runtime miss (the reporter's structural types carry no test).
type Assert<T extends true> = T;
type _ShapeGuards = [
  Assert<
    Pick<AssertionResult, 'fullName' | 'status' | 'duration'> extends JestAssertionResult
      ? true
      : false
  >,
  Assert<Pick<TestResult, 'testFilePath' | 'testResults'> extends JestFileResult ? true : false>,
  Assert<Pick<AggregatedResult, 'testResults'> extends JestAggregatedResult ? true : false>,
];

const consoleLogger: ReporterLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

/**
 * NoHotfix Jest reporter. Collects each `nhf`-tagged test's result during the run and submits them
 * once at `onRunComplete` to the 056 ingestion contract — driving the run's Go/No-Go gate with no
 * curl step, JUnit file, or title token. Mirrors the shipped Playwright/Vitest/Cypress reporters
 * over the shared, unchanged `@nohotfix/ci-core`.
 *
 * Jest instantiates a reporter as `new Reporter(globalConfig, reporterOptions, reporterContext)`,
 * so the customer's options arrive as the 2nd argument.
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
  private readonly globalConfig: JestGlobalConfig;
  private readonly tagDir: string;
  private readonly readTags: () => TagRecord[];
  private readonly clearTags: () => void;

  /** Final result per test, keyed by (testPath, fullName) — guards against a double-emit. */
  private readonly collected = new Map<string, Collected>();
  private config?: ReporterConfig;
  private configError?: Error;
  private commit: CommitResolution = { commit: null, source: 'none' };
  private shardSuffix = '0';

  constructor(
    globalConfig: JestGlobalConfig = {},
    options: ReporterOptions & ReporterTestHooks = {},
  ) {
    const {
      env,
      fetchImpl,
      logger,
      setExitCode,
      retries,
      sleep,
      appendFile,
      tagDir: tagDirOverride,
      readTags: readTagsOverride,
      clearTags: clearTagsOverride,
      ...publicOptions
    } = options;
    this.options = publicOptions;
    this.env = env ?? process.env;
    this.fetchImpl = fetchImpl ?? fetch;
    this.log = logger ?? consoleLogger;
    this.setExitCode = setExitCode ?? ((code) => void (process.exitCode = code));
    this.retries = retries;
    this.sleep = sleep;
    this.appendFile = appendFile;
    this.globalConfig = globalConfig ?? {};
    this.tagDir = tagDirOverride ?? tagDir();
    this.readTags = readTagsOverride ?? (() => readTags(this.tagDir));
    this.clearTags = clearTagsOverride ?? (() => clearTags(this.tagDir));
  }

  private summaryDeps() {
    return {
      info: (m: string) => this.log.info(m),
      warn: (m: string) => this.log.warn(m),
      env: this.env,
      appendFile: this.appendFile,
    };
  }

  /** Resolve shard identity, config, and commit; clear any stale tag files and prior results. */
  onRunStart(): void {
    this.shardSuffix = resolveShardSuffix(this.env, this.globalConfig);
    // A reporter instance is reused across `--watch` re-runs — drop the previous run's results so a
    // no-longer-run test can't be resubmitted, and start clean so a crash can't leak stale tags.
    this.collected.clear();
    this.clearTags();
    try {
      this.config = resolveConfig(this.env, this.options);
      this.commit = resolveCommit(this.env, this.config.commitOverride);
    } catch (error) {
      this.configError = error instanceof Error ? error : new Error(String(error));
      // Surface it early. Not a build failure — the exit-code contract reserves 401/403/400.
      this.log.error(`[NoHotfix] ${this.configError.message}`);
    }
  }

  async onRunComplete(_contexts?: unknown, results: JestAggregatedResult = {}): Promise<void> {
    try {
      if (this.configError) return; // already surfaced in onRunStart; never fails the build.
      const config = this.config;
      if (!config) return;

      this.collect(results);

      const submissions = this.buildResults();
      if (submissions.length === 0) {
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
        results: submissions,
      };

      // Dry-run: validate the credential, print the would-be payload, POST nothing.
      if (config.dryRun) {
        const pingOutcome = await ping(config, {
          fetchImpl: this.fetchImpl,
          ciKey: submissions[0]?.ciKey,
        });
        writeSummary(
          {
            apiUrl: config.apiUrl,
            dryRun: true,
            lines: buildSummaryLines(submissions, null, { pending: true }),
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
            lines: result.disposition ? buildSummaryLines(submissions, result.disposition) : [],
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
    } finally {
      // Always clean up the bridge temp dir, whatever happened above.
      this.clearTags();
    }
  }

  private collect(results: JestAggregatedResult): void {
    const registry = new Map<string, string>(
      this.readTags().map((r) => [resultKey(r.testPath, r.testName), r.ciKey]),
    );
    for (const file of results.testResults ?? []) {
      const testPath = file.testFilePath;
      for (const assertion of file.testResults ?? []) {
        const ciKey = readCiKey(testPath, assertion.fullName, registry);
        if (!ciKey) continue; // untagged tests are omitted.
        const duration = assertion.duration;
        this.collected.set(resultKey(testPath, assertion.fullName), {
          ciKey,
          status: mapJestStatus(assertion.status),
          durationMs: typeof duration === 'number' && duration > 0 ? Math.round(duration) : 0,
        });
      }
    }
  }

  private buildResults(): CiResultInput[] {
    const results: CiResultInput[] = [];
    for (const item of this.collected.values()) {
      const result: CiResultInput = { ciKey: item.ciKey, status: item.status };
      if (item.durationMs > 0) result.durationMs = item.durationMs;
      // `reportedAt` is intentionally omitted: Jest's AssertionResult exposes no per-test timestamp,
      // and we never emit a value at a precision the runner didn't give us.
      results.push(result);
    }
    return results;
  }
}

export { mapJestStatus, readCiKey, resolveShardSuffix, resultKey } from './map.js';
export { tagDir, type TagRecord } from './bridge.js';
