import type { EmittableCiStatus } from './types.js';

/**
 * A runner-agnostic outcome. Each reporter's thin adapter normalizes its runner's native
 * status into one of these, then calls {@link mapStatus}. Keeping the mapping here (not in
 * each reporter) is FR-017 — one status policy shared by every future reporter.
 */
export type RunnerOutcome = 'passed' | 'failed' | 'error' | 'skipped';

/**
 * Map a runner outcome to the status the server understands (FR-004).
 *
 * - `passed`  → `passed`
 * - `failed`  → `failed`   (an assertion/expectation failure)
 * - `error`   → `broken`   (a thrown error, timeout, crash, interruption, infra failure)
 * - `skipped` → `skipped`
 * - anything else (unknown/ambiguous) → `broken` — **never** silently `passed`, so the
 *   gate is never falsely satisfied.
 *
 * Retries are handled by the reporter (it reports the FINAL attempt's outcome); this function
 * is pure and has no notion of retries.
 */
export function mapStatus(outcome: RunnerOutcome | string): EmittableCiStatus {
  switch (outcome) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'error':
      return 'broken';
    case 'skipped':
      return 'skipped';
    default:
      return 'broken';
  }
}
