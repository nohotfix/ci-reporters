import { describe, expect, it, vi } from 'vitest';
import type { SubmitRequest } from '@nohotfix/ci-core';
import NoHotfixReporter, { type JestAggregatedResult } from '../index.js';
import type { TagRecord } from '../bridge.js';

// The reused 056 schema oracle (vendored in ci-core). Loaded at runtime — NOT re-defined — so the
// Jest reporter is held to the exact same contract as the other reporters. Loaded via a variable
// specifier so `tsc` doesn't pull ci-core's test file under this package's rootDir; `zod` resolves
// relative to the fixture's own location under packages/ci-core.
const FIXTURE = '../../../ci-core/src/__tests__/fixtures/server-schema';
async function loadRequestSchema(): Promise<{
  safeParse: (v: unknown) => { success: boolean };
}> {
  const mod = (await import(FIXTURE)) as {
    IngestResultsRequestSchema: { safeParse: (v: unknown) => { success: boolean } };
  };
  return mod.IngestResultsRequestSchema;
}

const FILE = '/repo/checkout.test.ts';
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

    const cases: Array<{ fullName: string; ciKey: string; status: string; duration?: number }> = [
      {
        fullName: 'checkout new user',
        ciKey: 'checkout.new-user.complete',
        status: 'passed',
        duration: 1234,
      },
      { fullName: 'billing retry', ciKey: 'billing.retry', status: 'failed', duration: 88 },
      { fullName: 'auth focused', ciKey: 'auth.focused', status: 'focused' }, // → broken
      { fullName: 'legacy flow', ciKey: 'legacy.flow', status: 'todo', duration: 0 }, // → skipped
    ];

    const tags: TagRecord[] = cases.map((c) => ({
      testPath: FILE,
      testName: c.fullName,
      ciKey: c.ciKey,
    }));
    const results: JestAggregatedResult = {
      testResults: [
        {
          testFilePath: FILE,
          testResults: cases.map((c) => ({
            fullName: c.fullName,
            status: c.status,
            duration: c.duration ?? 12,
          })),
        },
      ],
    };

    const reporter = new NoHotfixReporter(
      {},
      {
        env: baseEnv,
        fetchImpl,
        logger: { info() {}, warn() {}, error() {} },
        readTags: () => tags,
        clearTags: () => {},
      },
    );
    reporter.onRunStart();
    await reporter.onRunComplete(new Set(), results);

    expect(captured).toBeDefined();
    const schema = await loadRequestSchema();
    const parsed = schema.safeParse(captured);
    expect(parsed.success).toBe(true);
  });
});
