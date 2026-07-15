import { describe, expect, it, vi } from 'vitest';
import { buildIdempotencyKey } from '@nohotfix/ci-core';
import type { TestCase, Vitest } from 'vitest/node';
import NoHotfixReporter, { nhf, type ReporterLogger } from '../index.js';
import { NHF_META_KEY } from '../map.js';

// ── Test doubles ──────────────────────────────────────────────────────────────
interface CaseOpts {
  key?: string;
  state?: string;
  duration?: number;
  startTime?: number;
  retryCount?: number;
}

function makeCase(id: string, opts: CaseOpts = {}): TestCase {
  const meta: Record<string, unknown> = opts.key !== undefined ? { [NHF_META_KEY]: opts.key } : {};
  return {
    id,
    name: id,
    meta: () => meta,
    result: () => ({ state: opts.state ?? 'passed' }),
    diagnostic: () => ({
      duration: opts.duration ?? 10,
      startTime: opts.startTime ?? Date.parse('2026-06-25T12:00:00.000Z'),
      retryCount: opts.retryCount ?? 0,
      slow: false,
      heap: undefined,
      repeatCount: 0,
      flaky: false,
    }),
  } as unknown as TestCase;
}

function vitestWithShard(index: number): Vitest {
  return { config: { shard: { index, count: 9 } } } as unknown as Vitest;
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

async function run(reporter: NoHotfixReporter, cases: TestCase[], vitest?: Vitest) {
  reporter.onInit(vitest);
  for (const c of cases) reporter.onTestCaseResult(c);
  await reporter.onTestRunEnd();
}

function bodyOf(fetchImpl: ReturnType<typeof makeFetch>) {
  return JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
}

// ── US1: zero-friction Vitest → NoHotfix reporting ─────────────────────────────
describe('NoHotfixReporter (US1)', () => {
  it('reads the nhfKey metadata, collects, and submits once at onTestRunEnd', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });

    await run(reporter, [makeCase('t1', { key: 'checkout.smoke', duration: 42 })]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.nohotfix.com/api/ci/results');
    expect(bodyOf(fetchImpl)).toMatchObject({
      commit: 'abc123',
      environment: 'production',
      results: [{ ciKey: 'checkout.smoke', status: 'passed', durationMs: 42 }],
    });
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer nhf_t' });
  });

  it('omits tests without an nhfKey (submits only the tagged subset)', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [
      makeCase('t1', { key: 'kept' }),
      makeCase('t2'), // untagged
      makeCase('t3', { key: '' }), // empty → untagged
    ]);
    const body = bodyOf(fetchImpl);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].ciKey).toBe('kept');
  });

  it('maps Vitest states to the server enum', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [
      makeCase('p', { key: 'k.pass', state: 'passed' }),
      makeCase('f', { key: 'k.fail', state: 'failed' }),
      makeCase('s', { key: 'k.skip', state: 'skipped' }),
      makeCase('x', { key: 'k.broken', state: 'pending' }),
    ]);
    const byKey = Object.fromEntries(
      bodyOf(fetchImpl).results.map((r: { ciKey: string; status: string }) => [r.ciKey, r.status]),
    );
    expect(byKey).toEqual({
      'k.pass': 'passed',
      'k.fail': 'failed',
      'k.skip': 'skipped',
      'k.broken': 'broken',
    });
  });

  it('keeps the final attempt for a retried test', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    reporter.onInit();
    // Vitest settles onTestCaseResult once with the final attempt; guard also handles a double-fire.
    reporter.onTestCaseResult(makeCase('t1', { key: 'flaky.key', state: 'failed', retryCount: 0 }));
    reporter.onTestCaseResult(makeCase('t1', { key: 'flaky.key', state: 'passed', retryCount: 1 }));
    await reporter.onTestRunEnd();
    const body = bodyOf(fetchImpl);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].status).toBe('passed');
  });

  it('records a duplicate ci_key predictably (submits both entries, server dedupes)', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [
      makeCase('t1', { key: 'dup.key', state: 'passed' }),
      makeCase('t2', { key: 'dup.key', state: 'failed' }),
    ]);
    const body = bodyOf(fetchImpl);
    expect(body.results).toHaveLength(2);
    expect(body.results.every((r: { ciKey: string }) => r.ciKey === 'dup.key')).toBe(true);
  });

  it('skips submission (warns) when no commit resolves', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    const reporter = new NoHotfixReporter({
      env: { NOHOTFIX_INGEST_TOKEN: 't', NOHOTFIX_ENVIRONMENT: 'e' }, // no GITHUB_SHA
      fetchImpl,
      logger,
    });
    await run(reporter, [makeCase('t1', { key: 'k' })]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.some((l) => l.level === 'warn' && /NOHOTFIX_COMMIT/.test(l.msg))).toBe(true);
  });

  it('logs a clear error and does not submit when config is missing', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    const reporter = new NoHotfixReporter({ env: {}, fetchImpl, logger });
    await run(reporter, [makeCase('t1', { key: 'k' })]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.some((l) => l.level === 'error' && /misconfigured/.test(l.msg))).toBe(true);
  });

  it('does nothing (no error) when there are no tagged tests', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger });
    await run(reporter, [makeCase('t1')]);
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
    await run(reporter, [makeCase('t1', { key: 'typo.key' })]);
    expect(lines.some((l) => /typo\.key.*unknown_ci_key/.test(l.msg))).toBe(true);
  });
});

// ── US2: never breaks the build ────────────────────────────────────────────────
describe('NoHotfixReporter (US2 — never breaks the build)', () => {
  const oneTagged = () => [makeCase('t1', { key: 'k' })];

  it('fails clearly (exit 1) on a 401 bad token', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 401 });
    const { logger, lines } = makeLogger();
    const setExitCode = vi.fn();
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger, setExitCode });
    await run(reporter, oneTagged());
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(lines.some((l) => l.level === 'error' && /token/.test(l.msg))).toBe(true);
  });

  it('fails clearly (exit 1) on a 403 forbidden', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 403 });
    const setExitCode = vi.fn();
    const reporter = new NoHotfixReporter({
      env: baseEnv,
      fetchImpl,
      logger: makeLogger().logger,
      setExitCode,
    });
    await run(reporter, oneTagged());
    expect(setExitCode).toHaveBeenCalledWith(1);
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
    await run(reporter, oneTagged());
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
    await run(reporter, oneTagged());
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
    await run(reporter, oneTagged());
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
    await run(reporter, oneTagged());
    expect(setExitCode).not.toHaveBeenCalled();
  });
});

// ── US3: shard-safe, idempotent submissions ────────────────────────────────────
describe('NoHotfixReporter (US3 — sharding)', () => {
  const oneTagged = () => [makeCase('t1', { key: 'k' })];

  function idempotencyKeyOf(fetchImpl: ReturnType<typeof makeFetch>): string {
    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    return headers['idempotency-key']!;
  }

  it('uses the Vitest --shard identity (config.shard.index) with the "vitest" reporter name', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, oneTagged(), vitestWithShard(3));
    expect(idempotencyKeyOf(fetchImpl)).toBe(
      buildIdempotencyKey({
        commit: 'abc123',
        environment: 'production',
        reporterName: 'vitest',
        shardSuffix: '3',
      }),
    );
  });

  it('VITEST_SHARD_INDEX overrides the parsed --shard', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({
      env: { ...baseEnv, VITEST_SHARD_INDEX: '7' },
      fetchImpl,
      logger: makeLogger().logger,
    });
    await run(reporter, oneTagged(), vitestWithShard(3));
    expect(idempotencyKeyOf(fetchImpl)).toBe(
      buildIdempotencyKey({
        commit: 'abc123',
        environment: 'production',
        reporterName: 'vitest',
        shardSuffix: '7',
      }),
    );
  });

  it('distinct shards produce distinct keys; a re-run of the same shard is identical', async () => {
    const keyForShard = async (index: number) => {
      const fetchImpl = makeFetch({});
      const reporter = new NoHotfixReporter({
        env: baseEnv,
        fetchImpl,
        logger: makeLogger().logger,
      });
      await run(reporter, oneTagged(), vitestWithShard(index));
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
    await run(reporter, oneTagged());
    expect(idempotencyKeyOf(fetchImpl)).toBe(
      buildIdempotencyKey({
        commit: 'abc123',
        environment: 'production',
        reporterName: 'vitest',
        shardSuffix: '0',
      }),
    );
  });
});

// ── US4: honest, observable output + dry-run ───────────────────────────────────
describe('NoHotfixReporter (US4 — feedback + dry-run)', () => {
  const oneTagged = () => [makeCase('t1', { key: 'checkout.smoke', duration: 9 })];

  it('prints a per-test disposition line after a real submission', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger });
    await run(reporter, oneTagged());
    expect(lines.some((l) => /checkout\.smoke.*passed/.test(l.msg))).toBe(true);
  });

  it('writes the disposition to $GITHUB_STEP_SUMMARY in Actions (FR-009)', async () => {
    const fetchImpl = makeFetch({});
    const files: string[] = [];
    const reporter = new NoHotfixReporter({
      env: { ...baseEnv, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: '/tmp/s.md' },
      fetchImpl,
      logger: makeLogger().logger,
      appendFile: (_p, data) => files.push(data),
    });
    await run(reporter, oneTagged());
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/### NoHotfix CI results/);
    expect(files[0]).toMatch(/`checkout\.smoke`/);
  });

  it('dry-run validates the credential, prints would-be results, and POSTs nothing', async () => {
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
    await run(reporter, oneTagged());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('/api/ci/ping');
    expect(lines.some((l) => /DRY RUN — nothing was submitted/.test(l.msg))).toBe(true);
    expect(lines.some((l) => /Acme/.test(l.msg))).toBe(true);
  });
});

// ── Edge cases (T023) + fallback coexistence (T028) ────────────────────────────
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
    await run(reporter, [makeCase('t1', { key: 'k' })]);
    expect(setExitCode).not.toHaveBeenCalled();
    expect(lines.some((l) => /Submitted 1 result/.test(l.msg))).toBe(true);
  });

  it('omits durationMs when the duration is 0', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [makeCase('t1', { key: 'k', state: 'skipped', duration: 0 })]);
    expect(bodyOf(fetchImpl).results[0]).not.toHaveProperty('durationMs');
  });

  it('reads the raw metadata path (ctx.task.meta.nhfKey) identically to nhf.tag', async () => {
    // The helper and the raw path MUST target the same task-meta object.
    const meta: Record<string, unknown> = {};
    nhf.tag({ task: { meta } }, 'via.helper');
    expect(meta[NHF_META_KEY]).toBe('via.helper');
  });

  it('emits a payload that is byte-for-byte the 056 contract (coexists with JUnit/Action paths)', async () => {
    // The reporter must produce the SAME contract the JUnit-token path and the 065 Action
    // produce, so a team can migrate test-by-test (FR-013). Assert the exact request shape.
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [makeCase('t1', { key: 'a.b.c', state: 'failed', duration: 7 })]);
    const body = bodyOf(fetchImpl);
    expect(Object.keys(body).sort()).toEqual(['commit', 'environment', 'results']);
    expect(Object.keys(body.results[0]).sort()).toEqual([
      'ciKey',
      'durationMs',
      'reportedAt',
      'status',
    ]);
  });
});
