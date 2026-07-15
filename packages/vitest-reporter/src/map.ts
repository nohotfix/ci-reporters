import { mapStatus, type EmittableCiStatus } from '@nohotfix/ci-core';
import type { TestCase } from 'vitest/node';

/**
 * The reserved task-metadata key customers set to bind a test to its NoHotfix `ci_key`:
 * `ctx.task.meta.nhfKey = '<ci_key>'` (or, ergonomically, `nhf.tag(ctx, '<ci_key>')`).
 *
 * This is the Vitest analogue of the Playwright reporter's reserved `nhf` annotation type.
 * Defined once, used by both `nhf.tag` (write) and {@link readCiKey} (read) — they MUST
 * target the same `task.meta` object.
 */
export const NHF_META_KEY = 'nhfKey';

/**
 * The subset of Vitest's per-test config used to resolve the shard suffix — structural so the
 * shard resolution stays independently testable without a full `ResolvedConfig`.
 */
export interface ShardConfig {
  shard?: { index?: number } | undefined;
}

/**
 * Map Vitest's native test state to the server status, via the shared `mapStatus` policy.
 *
 * Vitest settles each `onTestCaseResult` to a terminal state — `passed`, `failed`, or `skipped`
 * (`test.todo` also settles to `skipped`). Anything non-terminal or unknown (e.g. `pending`) maps
 * through `mapStatus('error')` → `broken`, so the gate is **never** falsely satisfied.
 */
export function mapVitestStatus(state: string): EmittableCiStatus {
  switch (state) {
    case 'passed':
      return mapStatus('passed');
    case 'failed':
      return mapStatus('failed');
    case 'skipped':
    case 'todo':
      return mapStatus('skipped');
    default:
      // `pending` and any future/unknown state → broken, never silently `passed`.
      return mapStatus('error');
  }
}

/**
 * Read a test's `ci_key` from its `nhfKey` task metadata (FR-002). Trims the value and returns
 * the first non-empty string; an empty/whitespace value (or no metadata) reads as untagged and
 * returns `null` (the test is then omitted from submission, FR-003).
 */
export function readCiKey(testCase: TestCase): string | null {
  const meta = testCase.meta() as Record<string, unknown>;
  const raw = meta[NHF_META_KEY];
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

/**
 * Resolve this job's shard identity for the idempotency key (FR-007). Distinct shards must
 * produce distinct keys; a re-run of the same shard must reproduce its key.
 *
 * Priority: `VITEST_SHARD_INDEX` (explicit override) → Vitest's parsed `--shard=N/M`
 * (`config.shard.index`, 1-based) → `'0'` (unsharded). Returns a string suffix.
 */
export function resolveShardSuffix(env: NodeJS.ProcessEnv, config?: ShardConfig): string {
  const override = env.VITEST_SHARD_INDEX?.trim();
  if (override) return override;
  const index = config?.shard?.index;
  if (typeof index === 'number') return String(index);
  return '0';
}
