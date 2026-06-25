import { mapStatus, type EmittableCiStatus } from '@nohotfix/ci-core';
import type { FullConfig, TestCase, TestResult } from '@playwright/test/reporter';

/** The reserved annotation type customers write: `{ type: 'nhf', description: '<ci_key>' }`. */
export const NHF_ANNOTATION_TYPE = 'nhf';

/**
 * Map Playwright's native test status to the server status, via the shared `mapStatus` policy.
 *
 * Playwright collapses assertion failures and thrown errors both into `failed`, so we cannot
 * always distinguish `failed` from `broken`; we map `failed` → `failed` (the common case) and
 * the unambiguous infra outcomes (`timedOut`, `interrupted`) → `broken`. Unknown → `broken`.
 */
export function mapPlaywrightStatus(status: TestResult['status']): EmittableCiStatus {
  switch (status) {
    case 'passed':
      return mapStatus('passed');
    case 'failed':
      return mapStatus('failed');
    case 'timedOut':
    case 'interrupted':
      return mapStatus('error');
    case 'skipped':
      return mapStatus('skipped');
    default:
      return mapStatus('unknown');
  }
}

/**
 * Resolve this job's shard identity for the idempotency key (FR-010). Distinct shards must
 * produce distinct keys; a re-run of the same shard must reproduce its key.
 *
 * Priority: `PLAYWRIGHT_SHARD_INDEX` (explicit override) → Playwright's parsed `--shard`
 * (`config.shard.current`, 1-based) → `'0'` (unsharded). Returns a string suffix.
 */
export function resolveShardSuffix(env: NodeJS.ProcessEnv, config?: FullConfig): string {
  const override = env.PLAYWRIGHT_SHARD_INDEX?.trim();
  if (override) return override;
  const current = config?.shard?.current;
  if (typeof current === 'number') return String(current);
  return '0';
}

/**
 * Read a test's `ci_key` from its `nhf` annotation (FR-002). Looks at both the result-level
 * and case-level annotations (covering the config-level form and the runtime-push form), and
 * uses the FIRST `nhf` annotation with a non-empty description (FR-003). Returns null when the
 * test carries no `nhf` annotation (it is then omitted from submission).
 */
export function readCiKey(test: TestCase, result: TestResult): string | null {
  const sources = [...(result.annotations ?? []), ...(test.annotations ?? [])];
  for (const annotation of sources) {
    if (annotation.type === NHF_ANNOTATION_TYPE) {
      const value = annotation.description?.trim();
      if (value) return value;
    }
  }
  return null;
}
