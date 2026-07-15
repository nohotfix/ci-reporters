import { describe, expect, it, vi } from 'vitest';
import type { SubmitRequest } from '@nohotfix/ci-core';
import type { TestCase, Vitest } from 'vitest/node';
import NoHotfixReporter from '../index.js';
import { NHF_META_KEY } from '../map.js';

// The reused 056 schema oracle (vendored in ci-core). Loaded at runtime — NOT re-defined — so the
// Vitest reporter is held to the exact same contract as the Playwright reporter (FR-001). Loaded via
// a variable specifier so `tsc` doesn't pull ci-core's test file under this package's rootDir; `zod`
// resolves relative to the fixture's own location under packages/ci-core.
const FIXTURE = '../../../ci-core/src/__tests__/fixtures/server-schema';
async function loadRequestSchema(): Promise<{
  safeParse: (v: unknown) => { success: boolean };
}> {
  const mod = (await import(FIXTURE)) as {
    IngestResultsRequestSchema: { safeParse: (v: unknown) => { success: boolean } };
  };
  return mod.IngestResultsRequestSchema;
}

function makeCase(id: string, key: string, state: string, duration?: number): TestCase {
  return {
    id,
    name: id,
    meta: () => ({ [NHF_META_KEY]: key }),
    result: () => ({ state }),
    diagnostic: () => ({
      duration: duration ?? 12,
      startTime: Date.parse('2026-06-25T12:00:00.000Z'),
      retryCount: 0,
      slow: false,
      heap: undefined,
      repeatCount: 0,
      flaky: false,
    }),
  } as unknown as TestCase;
}

const baseEnv = {
  NOHOTFIX_INGEST_TOKEN: 'nhf_t',
  NOHOTFIX_ENVIRONMENT: 'production',
  GITHUB_SHA: 'a'.repeat(40),
};

describe('056 payload contract (FR-001)', () => {
  it('a representative emitted SubmitRequest validates against the ci-core 056 schema', async () => {
    let captured: SubmitRequest | undefined;
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      captured = JSON.parse(init!.body as string) as SubmitRequest;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          commit: 'c',
          environment: 'production',
          accepted: 4,
          ignored: [],
          appliedToLibrary: 4,
          appliedToOpenRuns: 4,
        }),
      } as unknown as Response;
    });

    const reporter = new NoHotfixReporter({
      env: baseEnv,
      fetchImpl,
      logger: { info() {}, warn() {}, error() {} },
    });

    reporter.onInit(undefined as unknown as Vitest);
    reporter.onTestCaseResult(makeCase('t1', 'checkout.new-user.complete', 'passed', 1234));
    reporter.onTestCaseResult(makeCase('t2', 'billing.retry', 'failed', 88));
    reporter.onTestCaseResult(makeCase('t3', 'auth.timeout', 'pending')); // → broken
    reporter.onTestCaseResult(makeCase('t4', 'legacy.flow', 'skipped', 0));
    await reporter.onTestRunEnd();

    expect(captured).toBeDefined();
    const schema = await loadRequestSchema();
    const parsed = schema.safeParse(captured);
    expect(parsed.success).toBe(true);
  });
});
