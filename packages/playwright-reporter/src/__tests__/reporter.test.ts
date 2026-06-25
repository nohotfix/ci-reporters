import { describe, expect, it, vi } from 'vitest';
import { buildIdempotencyKey } from '@nohotfix/ci-core';
import type { FullConfig, FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import NoHotfixReporter, { type ReporterLogger } from '../index.js';

// ── Test doubles ──────────────────────────────────────────────────────────────
type Annotation = { type: string; description?: string };

function makeTest(id: string, annotations: Annotation[]): TestCase {
  return { id, title: id, annotations } as unknown as TestCase;
}

function makeResult(
  status: TestResult['status'],
  opts: { retry?: number; duration?: number; annotations?: Annotation[] } = {},
): TestResult {
  return {
    status,
    retry: opts.retry ?? 0,
    duration: opts.duration ?? 10,
    startTime: new Date('2026-06-25T12:00:00.000Z'),
    annotations: opts.annotations ?? [],
  } as unknown as TestResult;
}

function makeLogger() {
  const lines: { level: string; msg: string }[] = [];
  const logger: ReporterLogger = {
    info: (m) => lines.push({ level: 'info', msg: m }),
    warn: (m) => lines.push({ level: 'warn', msg: m }),
    error: (m) => lines.push({ level: 'error', msg: m }),
  };
  return { logger, lines };
}

const okDisposition = {
  commit: 'c',
  environment: 'production',
  accepted: 1,
  ignored: [] as { ciKey: string; reason: string }[],
  appliedToLibrary: 1,
  appliedToOpenRuns: 1,
};

function makeFetch(response: { ok?: boolean; status?: number; body?: unknown }) {
  return vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      ({
        ok: response.ok ?? true,
        status: response.status ?? 200,
        json: async () => response.body ?? okDisposition,
      }) as unknown as Response,
  );
}

const baseEnv = {
  NOHOTFIX_INGEST_TOKEN: 'nhf_t',
  NOHOTFIX_ENVIRONMENT: 'production',
  GITHUB_SHA: 'abc123',
};

async function run(reporter: NoHotfixReporter, tests: [TestCase, TestResult][]) {
  reporter.onBegin();
  for (const [t, r] of tests) reporter.onTestEnd(t, r);
  await reporter.onEnd({ status: 'passed' } as FullResult);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('NoHotfixReporter (US1)', () => {
  it('reads the nhf annotation, collects, and submits once at onEnd', async () => {
    const fetchImpl = makeFetch({});
    const { logger } = makeLogger();
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger });

    await run(reporter, [
      [
        makeTest('t1', [{ type: 'nhf', description: 'checkout.smoke' }]),
        makeResult('passed', { duration: 42 }),
      ],
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.nohotfix.com/api/ci/results');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      commit: 'abc123',
      environment: 'production',
      results: [{ ciKey: 'checkout.smoke', status: 'passed', durationMs: 42 }],
    });
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer nhf_t' });
  });

  it('omits tests without an nhf annotation', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [
      [makeTest('t1', [{ type: 'nhf', description: 'kept' }]), makeResult('passed')],
      [makeTest('t2', []), makeResult('failed')],
      [makeTest('t3', [{ type: 'issue', description: 'JIRA-1' }]), makeResult('passed')],
    ]);
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].ciKey).toBe('kept');
  });

  it('uses the first nhf annotation when several are present', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [
      [
        makeTest('t1', [
          { type: 'nhf', description: 'first' },
          { type: 'nhf', description: 'second' },
        ]),
        makeResult('passed'),
      ],
    ]);
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.results[0].ciKey).toBe('first');
  });

  it('maps Playwright statuses to the server enum', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [
      [makeTest('p', [{ type: 'nhf', description: 'k.pass' }]), makeResult('passed')],
      [makeTest('f', [{ type: 'nhf', description: 'k.fail' }]), makeResult('failed')],
      [makeTest('to', [{ type: 'nhf', description: 'k.timeout' }]), makeResult('timedOut')],
      [makeTest('s', [{ type: 'nhf', description: 'k.skip' }]), makeResult('skipped')],
    ]);
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    const byKey = Object.fromEntries(
      body.results.map((r: { ciKey: string; status: string }) => [r.ciKey, r.status]),
    );
    expect(byKey).toEqual({
      'k.pass': 'passed',
      'k.fail': 'failed',
      'k.timeout': 'broken',
      'k.skip': 'skipped',
    });
  });

  it('keeps the final attempt for a retried test', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    const test = makeTest('t1', [{ type: 'nhf', description: 'flaky.key' }]);
    reporter.onBegin();
    reporter.onTestEnd(test, makeResult('failed', { retry: 0 }));
    reporter.onTestEnd(test, makeResult('passed', { retry: 1 }));
    await reporter.onEnd({ status: 'passed' } as FullResult);
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].status).toBe('passed');
  });

  it('reads a runtime-pushed annotation from the result', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [
      [
        makeTest('t1', []),
        makeResult('passed', { annotations: [{ type: 'nhf', description: 'runtime.key' }] }),
      ],
    ]);
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.results[0].ciKey).toBe('runtime.key');
  });

  it('skips submission (warns) when no commit resolves', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    const reporter = new NoHotfixReporter({
      env: { NOHOTFIX_INGEST_TOKEN: 't', NOHOTFIX_ENVIRONMENT: 'e' }, // no GITHUB_SHA
      fetchImpl,
      logger,
    });
    await run(reporter, [
      [makeTest('t1', [{ type: 'nhf', description: 'k' }]), makeResult('passed')],
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.some((l) => l.level === 'warn' && /NOHOTFIX_COMMIT/.test(l.msg))).toBe(true);
  });

  it('logs a clear error and does not submit when config is missing', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    const reporter = new NoHotfixReporter({ env: {}, fetchImpl, logger });
    await run(reporter, [
      [makeTest('t1', [{ type: 'nhf', description: 'k' }]), makeResult('passed')],
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.some((l) => l.level === 'error' && /misconfigured/.test(l.msg))).toBe(true);
  });

  it('does nothing (no error) when there are no annotated tests', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger });
    await run(reporter, [[makeTest('t1', []), makeResult('passed')]]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.some((l) => /nothing to submit/.test(l.msg))).toBe(true);
  });

  it('surfaces ignored keys from the disposition as warnings', async () => {
    const fetchImpl = makeFetch({
      body: {
        ...okDisposition,
        accepted: 0,
        ignored: [{ ciKey: 'typo.key', reason: 'unknown_ci_key' }],
      },
    });
    const { logger, lines } = makeLogger();
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger });
    await run(reporter, [
      [makeTest('t1', [{ type: 'nhf', description: 'typo.key' }]), makeResult('passed')],
    ]);
    expect(lines.some((l) => /typo\.key.*unknown_ci_key/.test(l.msg))).toBe(true);
  });
});

describe('NoHotfixReporter (US2 — never breaks the build)', () => {
  const oneTest: [TestCase, TestResult][] = [
    [makeTest('t1', [{ type: 'nhf', description: 'k' }]), makeResult('passed')],
  ];

  it('fails clearly (exit 1) on a 401 bad token', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 401 });
    const { logger, lines } = makeLogger();
    const setExitCode = vi.fn();
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger, setExitCode });
    await run(reporter, oneTest);
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(lines.some((l) => l.level === 'error' && /token/.test(l.msg))).toBe(true);
  });

  it('fails clearly (exit 1) on a 400 malformed payload', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 400 });
    const setExitCode = vi.fn();
    const reporter = new NoHotfixReporter({
      env: baseEnv,
      fetchImpl,
      logger: makeLogger().logger,
      setExitCode,
    });
    await run(reporter, oneTest);
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it('does NOT touch the exit code on a 5xx (warns instead)', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 500 });
    const { logger, lines } = makeLogger();
    const setExitCode = vi.fn();
    const reporter = new NoHotfixReporter({
      env: baseEnv,
      fetchImpl,
      logger,
      setExitCode,
      retries: 0, // keep the test fast
    });
    await run(reporter, oneTest);
    expect(setExitCode).not.toHaveBeenCalled();
    expect(lines.some((l) => l.level === 'warn' && /not affected/.test(l.msg))).toBe(true);
  });

  it('does NOT touch the exit code on a 429', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 429 });
    const setExitCode = vi.fn();
    const reporter = new NoHotfixReporter({
      env: baseEnv,
      fetchImpl,
      logger: makeLogger().logger,
      setExitCode,
    });
    await run(reporter, oneTest);
    expect(setExitCode).not.toHaveBeenCalled();
  });

  it('does NOT touch the exit code on a network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const setExitCode = vi.fn();
    const reporter = new NoHotfixReporter({
      env: baseEnv,
      fetchImpl,
      logger: makeLogger().logger,
      setExitCode,
      retries: 0,
    });
    await run(reporter, oneTest);
    expect(setExitCode).not.toHaveBeenCalled();
  });
});

describe('NoHotfixReporter (US3 — sharding)', () => {
  const oneTest: [TestCase, TestResult][] = [
    [makeTest('t1', [{ type: 'nhf', description: 'k' }]), makeResult('passed')],
  ];

  function idempotencyKeyOf(fetchImpl: ReturnType<typeof makeFetch>): string {
    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    return headers['idempotency-key']!;
  }

  it('uses the Playwright --shard identity (config.shard.current) in the key', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    reporter.onBegin({ shard: { current: 3, total: 5 } } as FullConfig);
    reporter.onTestEnd(oneTest[0]![0], oneTest[0]![1]);
    await reporter.onEnd({ status: 'passed' } as FullResult);
    expect(idempotencyKeyOf(fetchImpl)).toBe(
      buildIdempotencyKey({
        commit: 'abc123',
        environment: 'production',
        reporterName: 'playwright',
        shardSuffix: '3',
      }),
    );
  });

  it('PLAYWRIGHT_SHARD_INDEX overrides the parsed --shard', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({
      env: { ...baseEnv, PLAYWRIGHT_SHARD_INDEX: '7' },
      fetchImpl,
      logger: makeLogger().logger,
    });
    reporter.onBegin({ shard: { current: 3, total: 5 } } as FullConfig);
    reporter.onTestEnd(oneTest[0]![0], oneTest[0]![1]);
    await reporter.onEnd({ status: 'passed' } as FullResult);
    expect(idempotencyKeyOf(fetchImpl)).toBe(
      buildIdempotencyKey({
        commit: 'abc123',
        environment: 'production',
        reporterName: 'playwright',
        shardSuffix: '7',
      }),
    );
  });

  it('distinct shards produce distinct keys; a re-run of the same shard is identical', async () => {
    const keyForShard = async (current: number) => {
      const fetchImpl = makeFetch({});
      const reporter = new NoHotfixReporter({
        env: baseEnv,
        fetchImpl,
        logger: makeLogger().logger,
      });
      reporter.onBegin({ shard: { current, total: 2 } } as FullConfig);
      reporter.onTestEnd(oneTest[0]![0], oneTest[0]![1]);
      await reporter.onEnd({ status: 'passed' } as FullResult);
      return idempotencyKeyOf(fetchImpl);
    };
    const shard1 = await keyForShard(1);
    const shard2 = await keyForShard(2);
    const shard1Rerun = await keyForShard(1);
    expect(shard1).not.toBe(shard2);
    expect(shard1).toBe(shard1Rerun);
  });

  it('defaults the shard suffix to 0 when unsharded', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, oneTest);
    expect(idempotencyKeyOf(fetchImpl)).toBe(
      buildIdempotencyKey({
        commit: 'abc123',
        environment: 'production',
        reporterName: 'playwright',
        shardSuffix: '0',
      }),
    );
  });
});

describe('NoHotfixReporter (US4 — feedback + dry-run)', () => {
  const oneTest: [TestCase, TestResult][] = [
    [
      makeTest('t1', [{ type: 'nhf', description: 'checkout.smoke' }]),
      makeResult('passed', { duration: 9 }),
    ],
  ];

  it('prints a per-test disposition line after a real submission', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger });
    await run(reporter, oneTest);
    expect(lines.some((l) => /checkout\.smoke.*passed/.test(l.msg))).toBe(true);
  });

  it('writes the disposition to $GITHUB_STEP_SUMMARY in Actions (FR-014)', async () => {
    const fetchImpl = makeFetch({});
    const files: string[] = [];
    const reporter = new NoHotfixReporter({
      env: { ...baseEnv, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: '/tmp/s.md' },
      fetchImpl,
      logger: makeLogger().logger,
      appendFile: (_p, data) => files.push(data),
    });
    await run(reporter, oneTest);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/### NoHotfix CI results/);
    expect(files[0]).toMatch(/`checkout\.smoke`/);
  });

  it('dry-run validates the credential, prints would-be results, and POSTs nothing', async () => {
    // ping returns a Response; the results POST must never be called.
    const fetchImpl = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/ci/ping')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, org: { slug: 'a', name: 'Acme' } }),
        } as unknown as Response;
      }
      throw new Error(`unexpected POST to ${url} during dry-run`);
    });
    const { logger, lines } = makeLogger();
    const reporter = new NoHotfixReporter({
      env: { ...baseEnv, NOHOTFIX_DRY_RUN: 'true' },
      fetchImpl,
      logger,
    });
    await run(reporter, oneTest);
    // exactly one call — the ping — and no /results POST
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('/api/ci/ping');
    expect(lines.some((l) => /DRY RUN — nothing was submitted/.test(l.msg))).toBe(true);
    expect(lines.some((l) => /Acme/.test(l.msg))).toBe(true);
  });
});

describe('NoHotfixReporter (edge cases)', () => {
  it('a sealed run (appliedToOpenRuns: 0) records to the library without error', async () => {
    const fetchImpl = makeFetch({
      body: {
        commit: 'c',
        environment: 'production',
        accepted: 1,
        ignored: [],
        appliedToLibrary: 1,
        appliedToOpenRuns: 0,
      },
    });
    const { logger, lines } = makeLogger();
    const setExitCode = vi.fn();
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger, setExitCode });
    await run(reporter, [
      [makeTest('t1', [{ type: 'nhf', description: 'k' }]), makeResult('passed')],
    ]);
    expect(setExitCode).not.toHaveBeenCalled();
    expect(lines.some((l) => /Submitted 1 result/.test(l.msg))).toBe(true);
  });

  it('omits durationMs when the duration is 0', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [
      [makeTest('t1', [{ type: 'nhf', description: 'k' }]), makeResult('skipped', { duration: 0 })],
    ]);
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.results[0]).not.toHaveProperty('durationMs');
  });

  it('ignores a malformed nhf annotation (empty description) and omits the test', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger });
    await run(reporter, [
      [makeTest('t1', [{ type: 'nhf', description: '   ' }]), makeResult('passed')],
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.some((l) => /nothing to submit/.test(l.msg))).toBe(true);
  });

  it('emits a payload that is byte-for-byte the 056 contract (coexists with JUnit/Action paths)', async () => {
    // The reporter must produce the SAME contract the JUnit-token path and the 065 Action
    // produce, so a team can migrate test-by-test (FR-018). Assert the exact request shape.
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [
      [
        makeTest('t1', [{ type: 'nhf', description: 'a.b.c' }]),
        makeResult('failed', { duration: 7 }),
      ],
    ]);
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(Object.keys(body).sort()).toEqual(['commit', 'environment', 'results']);
    expect(Object.keys(body.results[0]).sort()).toEqual([
      'ciKey',
      'durationMs',
      'reportedAt',
      'status',
    ]);
  });
});
