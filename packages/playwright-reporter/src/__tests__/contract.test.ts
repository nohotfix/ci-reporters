import { describe, expect, it, vi } from 'vitest';
import type { SubmitRequest } from '@nohotfix/ci-core';
import type { FullConfig, FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import NoHotfixReporter from '../index.js';

// The reused 056 schema oracle (vendored in ci-core). Loaded at runtime — NOT re-defined — so the
// Playwright reporter is held to the exact same contract as the Vitest/Cypress reporters. Loaded via
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

type Annotation = { type: string; description?: string };
function makeTest(annotations: Annotation[]): TestCase {
  return { annotations } as unknown as TestCase;
}
function makeResult(status: TestResult['status'], duration?: number): TestResult {
  return {
    status,
    retry: 0,
    duration: duration ?? 12,
    startTime: new Date('2026-06-25T12:00:00.000Z'),
    annotations: [],
  } as unknown as TestResult;
}

const baseEnv = {
  NOHOTFIX_INGEST_TOKEN: 'nhf_t',
  NOHOTFIX_ENVIRONMENT: 'production',
  GITHUB_SHA: 'a'.repeat(40),
};

describe('056 payload contract', () => {
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

    reporter.onBegin(undefined as unknown as FullConfig);
    reporter.onTestEnd(
      makeTest([{ type: 'nhf', description: 'checkout.new-user.complete' }]),
      makeResult('passed', 1234),
    );
    reporter.onTestEnd(
      makeTest([{ type: 'nhf', description: 'billing.retry' }]),
      makeResult('failed', 88),
    );
    reporter.onTestEnd(
      makeTest([{ type: 'nhf', description: 'auth.timeout' }]),
      makeResult('timedOut'),
    ); // → broken
    reporter.onTestEnd(
      makeTest([{ type: 'nhf', description: 'legacy.flow' }]),
      makeResult('skipped', 0),
    );
    await reporter.onEnd({ status: 'passed' } as FullResult);

    expect(captured).toBeDefined();
    const schema = await loadRequestSchema();
    const parsed = schema.safeParse(captured);
    expect(parsed.success).toBe(true);
  });
});
