import { mapStatus, type EmittableCiStatus } from '@nohotfix/ci-core';
import { NHF_TASK_NAME } from './task-name.js';

// Re-export the reserved tag identifier for the Node side. This is the Cypress analogue of the
// Playwright reporter's reserved `nhf` annotation type / the Vitest reporter's `nhfKey` meta key:
// Cypress has no per-test Node-visible metadata, so the tag is bridged over a reserved `cy.task`.
export { NHF_TASK_NAME } from './task-name.js';
export type { NhfTagPayload } from './task-name.js';

/**
 * Map Cypress's native test state to the server status, via the shared `mapStatus` policy.
 *
 * Cypress (Mocha) settles each test to `passed`, `failed`, `pending` (an intentional `it.skip` /
 * a test with no body), or `skipped` (a test that never ran because a sibling `before`/`beforeEach`
 * hook failed — an aborted, non-result outcome). We map:
 *
 * - `passed`  → `passed`
 * - `failed`  → `failed`
 * - `pending` → `skipped`  (an intentional skip)
 * - `skipped` → `broken`   (aborted by a hook failure — ambiguous, so never silently `passed`)
 * - anything unknown/non-terminal → `broken`, so the gate is **never** falsely satisfied.
 */
export function mapCypressStatus(state: string): EmittableCiStatus {
  switch (state) {
    case 'passed':
      return mapStatus('passed');
    case 'failed':
      return mapStatus('failed');
    case 'pending':
      return mapStatus('skipped');
    case 'skipped':
      // Aborted by an upstream hook failure — a genuine non-result, not a skip.
      return mapStatus('error');
    default:
      return mapStatus('error');
  }
}

/**
 * The stable key a test is identified by within a single `cypress run` — its spec-relative path
 * plus its full Mocha title path. `nhf.tag` records the key against the *current* test's spec +
 * title path (from the browser); the reporter looks it up against each `after:run` test's spec +
 * title path (in Node). Because both sides compute the key from the live values, a title/describe
 * rename moves the tag with the test.
 *
 * `JSON.stringify` (not a join) makes the key unambiguous regardless of spec/title content — no
 * separator can collide (`['foo','bar']` and `['foob','ar']` stay distinct) — and scoping by spec
 * keeps same-titled tests in different spec files from overwriting one another. Cypress keeps one
 * Node plugin process for the whole run, so a title path alone is not unique.
 */
export function resultKey(specId: string | undefined, titlePath: string[]): string {
  return JSON.stringify([specId ?? '', titlePath]);
}

/**
 * Read a test's `ci_key` from the tag registry the plugin populated over `cy.task`. Returns the
 * trimmed key when the test was tagged, or `null` when it carries no `nhf.tag` (that test is then
 * omitted from submission).
 */
export function readCiKey(
  specId: string | undefined,
  titlePath: string[],
  registry: Map<string, string>,
): string | null {
  const raw = registry.get(resultKey(specId, titlePath));
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

/**
 * Resolve this job's shard identity for the idempotency key. Distinct shards must produce distinct
 * keys; a re-run of the same shard must reproduce its key.
 *
 * Cypress has no native `--shard` flag — sharding is done by external orchestration (splitting
 * `--spec`, or a parallelization service). So the identity comes solely from `CYPRESS_SHARD_INDEX`
 * (set by that orchestration); unset → `'0'` (unsharded). Returns a string suffix.
 */
export function resolveShardSuffix(env: NodeJS.ProcessEnv): string {
  const override = env.CYPRESS_SHARD_INDEX?.trim();
  if (override) return override;
  return '0';
}
