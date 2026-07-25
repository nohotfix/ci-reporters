import { describe, expect, it, vi } from 'vitest';
import { buildIdempotencyKey } from '@nohotfix/ci-core';
import NoHotfixReporter, {
  setupNoHotfix,
  type CypressPluginEvents,
  type CypressRunResultLike,
  type CypressTestResult,
  type ReporterLogger,
} from '../index.js';
import { NHF_TASK_NAME } from '../map.js';

// ── Test doubles ──────────────────────────────────────────────────────────────
const DEFAULT_SPEC = 'checkout.cy.ts';

interface CaseOpts {
  ciKey?: string; // omitted → untagged
  specId?: string;
  state?: string;
  duration?: number;
  attempts?: CypressTestResult['attempts'];
}

interface Case {
  specId: string;
  titlePath: string[];
  ciKey?: string;
  test: CypressTestResult;
}

function makeCase(titlePath: string[], opts: CaseOpts = {}): Case {
  const state = opts.state ?? 'passed';
  const duration = opts.duration ?? 10;
  return {
    specId: opts.specId ?? DEFAULT_SPEC,
    titlePath,
    ciKey: opts.ciKey,
    test: {
      title: titlePath,
      state,
      duration,
      attempts: opts.attempts ?? [{ state }],
    },
  };
}

// Group cases into one Cypress "run" per spec, mirroring the real after:run payload (which carries
// each spec's `spec.relative`).
function runResultOf(cases: Case[]): CypressRunResultLike {
  const bySpec = new Map<string, Case[]>();
  for (const c of cases) {
    const list = bySpec.get(c.specId) ?? [];
    list.push(c);
    bySpec.set(c.specId, list);
  }
  return {
    runs: [...bySpec].map(([relative, cs]) => ({
      spec: { relative },
      tests: cs.map((c) => c.test),
    })),
  };
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

async function run(reporter: NoHotfixReporter, cases: Case[]) {
  reporter.onRunBegin();
  for (const c of cases) {
    if (c.ciKey !== undefined)
      reporter.recordCiKey({ specId: c.specId, titlePath: c.titlePath, ciKey: c.ciKey });
  }
  await reporter.onRunEnd(runResultOf(cases));
}

function bodyOf(fetchImpl: ReturnType<typeof makeFetch>) {
  return JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
}

// ── US1: zero-friction Cypress → NoHotfix reporting ────────────────────────────
describe('NoHotfixReporter (US1)', () => {
  it('reads the recorded tag, collects, and submits once at onRunEnd', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });

    await run(reporter, [
      makeCase(['checkout', 'smoke'], { ciKey: 'checkout.smoke', duration: 42 }),
    ]);

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

  it('omits tests without a recorded tag (submits only the tagged subset)', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [
      makeCase(['kept'], { ciKey: 'kept' }),
      makeCase(['untagged']), // no tag
      makeCase(['empty'], { ciKey: '' }), // empty → untagged
    ]);
    const body = bodyOf(fetchImpl);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].ciKey).toBe('kept');
  });

  it('maps Cypress states to the server enum', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [
      makeCase(['p'], { ciKey: 'k.pass', state: 'passed' }),
      makeCase(['f'], { ciKey: 'k.fail', state: 'failed' }),
      makeCase(['s'], { ciKey: 'k.skip', state: 'pending' }),
      makeCase(['x'], { ciKey: 'k.broken', state: 'skipped' }),
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

  it('reports the final resolved state of a retried test (not an earlier attempt)', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    // Cypress settles the test's `state` to the final outcome; earlier attempts stay in `attempts`.
    await run(reporter, [
      makeCase(['flaky'], {
        ciKey: 'flaky.key',
        state: 'passed',
        attempts: [{ state: 'failed' }, { state: 'passed' }],
      }),
    ]);
    const body = bodyOf(fetchImpl);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].status).toBe('passed');
  });

  it('scopes tags by spec — the same title path in two spec files both submit (no collision)', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [
      makeCase(['smoke', 'runs'], { specId: 'a.cy.ts', ciKey: 'a.smoke', state: 'passed' }),
      makeCase(['smoke', 'runs'], { specId: 'b.cy.ts', ciKey: 'b.smoke', state: 'failed' }),
    ]);
    const byKey = Object.fromEntries(
      bodyOf(fetchImpl).results.map((r: { ciKey: string; status: string }) => [r.ciKey, r.status]),
    );
    expect(byKey).toEqual({ 'a.smoke': 'passed', 'b.smoke': 'failed' });
  });

  it('omits reportedAt — Cypress exposes no per-test timestamp', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [makeCase(['t'], { ciKey: 'k' })]);
    expect(bodyOf(fetchImpl).results[0]).not.toHaveProperty('reportedAt');
  });

  it('records a duplicate ci_key predictably (submits both entries, server dedupes)', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [
      makeCase(['a'], { ciKey: 'dup.key', state: 'passed' }),
      makeCase(['b'], { ciKey: 'dup.key', state: 'failed' }),
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
    await run(reporter, [makeCase(['t'], { ciKey: 'k' })]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.some((l) => l.level === 'warn' && /NOHOTFIX_COMMIT/.test(l.msg))).toBe(true);
  });

  it('logs a clear error and does not submit when config is missing', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    const reporter = new NoHotfixReporter({ env: {}, fetchImpl, logger });
    await run(reporter, [makeCase(['t'], { ciKey: 'k' })]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.some((l) => l.level === 'error' && /misconfigured/.test(l.msg))).toBe(true);
  });

  it('does nothing (no error) when there are no tagged tests', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger });
    await run(reporter, [makeCase(['t'])]);
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
    await run(reporter, [makeCase(['t'], { ciKey: 'typo.key' })]);
    expect(lines.some((l) => /typo\.key.*unknown_ci_key/.test(l.msg))).toBe(true);
  });
});

// ── US2: never breaks the build ────────────────────────────────────────────────
describe('NoHotfixReporter (US2 — never breaks the build)', () => {
  const oneTagged = () => [makeCase(['t'], { ciKey: 'k' })];

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

  it('warns and submits nothing when Cypress fails to run (CypressFailedRunResult)', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    const setExitCode = vi.fn();
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger, setExitCode });
    reporter.onRunBegin();
    await reporter.onRunEnd({ status: 'failed', message: 'Could not find any spec files' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(setExitCode).not.toHaveBeenCalled();
    expect(lines.some((l) => l.level === 'warn' && /did not run/.test(l.msg))).toBe(true);
  });
});

// ── US3: shard-safe, idempotent submissions ────────────────────────────────────
describe('NoHotfixReporter (US3 — sharding)', () => {
  const oneTagged = () => [makeCase(['t'], { ciKey: 'k' })];

  function idempotencyKeyOf(fetchImpl: ReturnType<typeof makeFetch>): string {
    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    return headers['idempotency-key']!;
  }

  it('uses the CYPRESS_SHARD_INDEX identity with the "cypress" reporter name', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({
      env: { ...baseEnv, CYPRESS_SHARD_INDEX: '3' },
      fetchImpl,
      logger: makeLogger().logger,
    });
    await run(reporter, oneTagged());
    expect(idempotencyKeyOf(fetchImpl)).toBe(
      buildIdempotencyKey({
        commit: 'abc123',
        environment: 'production',
        reporterName: 'cypress',
        shardSuffix: '3',
      }),
    );
  });

  it('distinct shards produce distinct keys; a re-run of the same shard is identical', async () => {
    const keyForShard = async (index: string) => {
      const fetchImpl = makeFetch({});
      const reporter = new NoHotfixReporter({
        env: { ...baseEnv, CYPRESS_SHARD_INDEX: index },
        fetchImpl,
        logger: makeLogger().logger,
      });
      await run(reporter, oneTagged());
      return idempotencyKeyOf(fetchImpl);
    };
    const shard1 = await keyForShard('1');
    const shard2 = await keyForShard('2');
    const shard1Rerun = await keyForShard('1');
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
        reporterName: 'cypress',
        shardSuffix: '0',
      }),
    );
  });
});

// ── US4: honest, observable output + dry-run ───────────────────────────────────
describe('NoHotfixReporter (US4 — feedback + dry-run)', () => {
  const oneTagged = () => [
    makeCase(['checkout', 'smoke'], { ciKey: 'checkout.smoke', duration: 9 }),
  ];

  it('prints a per-test disposition line after a real submission', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger });
    await run(reporter, oneTagged());
    expect(lines.some((l) => /checkout\.smoke.*passed/.test(l.msg))).toBe(true);
  });

  it('writes the disposition to $GITHUB_STEP_SUMMARY in Actions', async () => {
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

// ── Edge cases + the plugin registrar ──────────────────────────────────────────
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
    await run(reporter, [makeCase(['t'], { ciKey: 'k' })]);
    expect(setExitCode).not.toHaveBeenCalled();
    expect(lines.some((l) => /Submitted 1 result/.test(l.msg))).toBe(true);
  });

  it('omits durationMs when the duration is 0', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [makeCase(['t'], { ciKey: 'k', state: 'pending', duration: 0 })]);
    expect(bodyOf(fetchImpl).results[0]).not.toHaveProperty('durationMs');
  });

  it('emits a payload that is byte-for-byte the 056 contract (coexists with JUnit/Action paths)', async () => {
    const fetchImpl = makeFetch({});
    const reporter = new NoHotfixReporter({ env: baseEnv, fetchImpl, logger: makeLogger().logger });
    await run(reporter, [
      makeCase(['a', 'b', 'c'], { ciKey: 'a.b.c', state: 'failed', duration: 7 }),
    ]);
    const body = bodyOf(fetchImpl);
    expect(Object.keys(body).sort()).toEqual(['commit', 'environment', 'results']);
    // reportedAt is intentionally absent for Cypress (no per-test timestamp in after:run).
    expect(Object.keys(body.results[0]).sort()).toEqual(['ciKey', 'durationMs', 'status']);
  });
});

// ── setupNoHotfix: the Cypress plugin registrar ────────────────────────────────
describe('setupNoHotfix (plugin registrar)', () => {
  it('registers the nhf task + after:run, bridges the tag, and submits once', async () => {
    const fetchImpl = makeFetch({});
    // Capture what the plugin registers.
    let taskHandler: ((arg: unknown) => unknown) | undefined;
    let afterRun: ((results: CypressRunResultLike) => void | Promise<void>) | undefined;
    const on = ((event: string, arg: unknown) => {
      if (event === 'task') {
        taskHandler = (arg as Record<string, (a: unknown) => unknown>)[NHF_TASK_NAME];
      } else if (event === 'after:run') {
        afterRun = arg as (results: CypressRunResultLike) => void | Promise<void>;
      }
    }) as unknown as CypressPluginEvents;

    const config = { projectId: 'demo' };
    const returned = setupNoHotfix(on, config, {
      env: baseEnv,
      fetchImpl,
      logger: makeLogger().logger,
    });

    // The registrar returns the config untouched, and registered both hooks.
    expect(returned).toBe(config);
    expect(typeof taskHandler).toBe('function');
    expect(typeof afterRun).toBe('function');

    // Simulate the browser tagging a test, then the run ending.
    expect(
      taskHandler!({
        specId: DEFAULT_SPEC,
        titlePath: ['checkout', 'smoke'],
        ciKey: 'checkout.smoke',
      }),
    ).toBeNull();
    await afterRun!(runResultOf([makeCase(['checkout', 'smoke'], { ciKey: 'checkout.smoke' })]));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchImpl).results[0].ciKey).toBe('checkout.smoke');
  });
});
