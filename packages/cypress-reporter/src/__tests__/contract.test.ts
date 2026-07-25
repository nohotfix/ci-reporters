import { describe, expect, it, vi } from 'vitest';
import type { SubmitRequest } from '@nohotfix/ci-core';
import NoHotfixReporter, { type CypressRunResultLike, type CypressTestResult } from '../index.js';

// The reused 056 schema oracle (vendored in ci-core). Loaded at runtime — NOT re-defined — so the
// Cypress reporter is held to the exact same contract as the Playwright/Vitest reporters. Loaded via
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

function makeTest(titlePath: string[], state: string, duration?: number): CypressTestResult {
  return {
    title: titlePath,
    state,
    duration: duration ?? 12,
    attempts: [{ state }],
  };
}

const SPEC = 'checkout.cy.ts';

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

    const cases: Array<{ titlePath: string[]; ciKey: string; test: CypressTestResult }> = [
      {
        titlePath: ['checkout', 'new user'],
        ciKey: 'checkout.new-user.complete',
        test: makeTest(['checkout', 'new user'], 'passed', 1234),
      },
      {
        titlePath: ['billing', 'retry'],
        ciKey: 'billing.retry',
        test: makeTest(['billing', 'retry'], 'failed', 88),
      },
      {
        titlePath: ['auth', 'aborted'],
        ciKey: 'auth.aborted',
        test: makeTest(['auth', 'aborted'], 'skipped'),
      }, // → broken
      {
        titlePath: ['legacy', 'flow'],
        ciKey: 'legacy.flow',
        test: makeTest(['legacy', 'flow'], 'pending', 0),
      }, // → skipped
    ];

    reporter.onRunBegin();
    for (const c of cases)
      reporter.recordCiKey({ specId: SPEC, titlePath: c.titlePath, ciKey: c.ciKey });
    const runResult: CypressRunResultLike = {
      runs: [{ spec: { relative: SPEC }, tests: cases.map((c) => c.test) }],
    };
    await reporter.onRunEnd(runResult);

    expect(captured).toBeDefined();
    const schema = await loadRequestSchema();
    const parsed = schema.safeParse(captured);
    expect(parsed.success).toBe(true);
  });
});
