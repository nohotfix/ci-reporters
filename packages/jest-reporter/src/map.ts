import { mapStatus, type EmittableCiStatus } from '@nohotfix/ci-core';

/**
 * Map Jest's native `AssertionResult` status to the server status, via the shared `mapStatus`
 * policy. Jest's statuses are `passed`, `failed`, `skipped`, `pending` (`it.skip` / `xit`), `todo`
 * (`it.todo`), `disabled` (`describe.skip` / `xdescribe`), and `focused` (`it.only`, legacy runner).
 *
 * - `passed` → `passed`
 * - `failed` → `failed`
 * - `skipped` / `pending` / `todo` / `disabled` → `skipped` (all intentional non-runs)
 * - `focused` / anything unknown → `broken` — we can't derive a pass/fail from it, so **never**
 *   silently `passed`; the gate is never falsely satisfied.
 */
export function mapJestStatus(status: string): EmittableCiStatus {
  switch (status) {
    case 'passed':
      return mapStatus('passed');
    case 'failed':
      return mapStatus('failed');
    case 'skipped':
    case 'pending':
    case 'todo':
    case 'disabled':
      return mapStatus('skipped');
    default:
      return mapStatus('error');
  }
}

/**
 * The key a test is identified by within a run — its spec file path plus its full Mocha-style name.
 * `nhf.tag` records the key against `expect.getState()`'s `testPath` + `currentTestName`; the
 * reporter looks it up against each `AssertionResult`'s `testFilePath` + `fullName`. `JSON.stringify`
 * (not a join) keeps the key unambiguous regardless of path/name content.
 */
export function resultKey(testPath: string, testName: string): string {
  return JSON.stringify([testPath, testName]);
}

/**
 * Read a test's `ci_key` from the tag registry the reporter built from the bridge files. Returns the
 * trimmed key when the test was tagged, or `null` when it carries no `nhf.tag` (that test is then
 * omitted from submission).
 */
export function readCiKey(
  testPath: string,
  testName: string,
  registry: Map<string, string>,
): string | null {
  const raw = registry.get(resultKey(testPath, testName));
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

/** The subset of Jest's `GlobalConfig` used to resolve the shard identity. */
export interface JestShardConfig {
  shard?: { shardIndex?: number } | undefined;
}

/**
 * Resolve this job's shard identity for the idempotency key. Distinct shards must produce distinct
 * keys; a re-run of the same shard must reproduce its key.
 *
 * Priority: `JEST_SHARD_INDEX` (explicit override) → Jest's parsed `--shard=N/M`
 * (`globalConfig.shard.shardIndex`, 1-based) → `'0'` (unsharded). Returns a string suffix.
 */
export function resolveShardSuffix(env: NodeJS.ProcessEnv, globalConfig?: JestShardConfig): string {
  const override = env.JEST_SHARD_INDEX?.trim();
  if (override) return override;
  const index = globalConfig?.shard?.shardIndex;
  if (typeof index === 'number') return String(index);
  return '0';
}
