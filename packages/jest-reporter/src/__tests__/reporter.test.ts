import { describe, expect, it, vi } from 'vitest';
import { buildIdempotencyKey } from '@nohotfix/ci-core';
import NoHotfixReporter, {
  type JestAggregatedResult,
  type JestGlobalConfig,
  type ReporterLogger,
} from '../index.js';
import type { TagRecord } from '../bridge.js';

// ── Test doubles ──────────────────────────────────────────────────────────────
const DEFAULT_FILE = '/repo/checkout.test.ts';

interface Case {
  fullName: string;
  ciKey?: string; // omitted → untagged
  file?: string;
  status?: string;
  duration?: number;
}

function records(cases: Case[]): TagRecord[] {
  return cases
    .filter((c) => c.ciKey !== undefined)
    .map((c) => ({ testPath: c.file ?? DEFAULT_FILE, testName: c.fullName, ciKey: c.ciKey! }));
}

// Group cases into one Jest file result per file, mirroring the real onRunComplete aggregate.
function aggOf(cases: Case[]): JestAggregatedResult {
  const byFile = new Map<string, Case[]>();
  for (const c of cases) {
    const file = c.file ?? DEFAULT_FILE;
    const list = byFile.get(file) ?? [];
    list.push(c);
    byFile.set(file, list);
  }
  return {
    testResults: [...byFile].map(([testFilePath, cs]) => ({
      testFilePath,
      testResults: cs.map((c) => ({
        fullName: c.fullName,
        status: c.status ?? 'passed',
        duration: c.duration ?? 10,
      })),
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

interface Hooks {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: ReturnType<typeof makeFetch>;
  logger?: ReporterLogger;
  setExitCode?: (code: number) => void;
  retries?: number;
  globalConfig?: JestGlobalConfig;
}

// Drive a full run: construct the reporter (tag registry injected from `cases`), then
// onRunStart → onRunComplete over the aggregate built from the same cases.
async function run(cases: Case[], hooks: Hooks = {}): Promise<void> {
  const reporter = new NoHotfixReporter(hooks.globalConfig ?? {}, {
    env: hooks.env ?? baseEnv,
    fetchImpl: hooks.fetchImpl ?? makeFetch({}),
    logger: hooks.logger ?? makeLogger().logger,
    setExitCode: hooks.setExitCode,
    retries: hooks.retries,
    readTags: () => records(cases),
    clearTags: () => {},
  });
  reporter.onRunStart();
  await reporter.onRunComplete(new Set(), aggOf(cases));
}

function bodyOf(fetchImpl: ReturnType<typeof makeFetch>) {
  return JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
}

// ── US1: zero-friction Jest → NoHotfix reporting ───────────────────────────────
describe('NoHotfixReporter (US1)', () => {
  it('reads the recorded tag, collects, and submits once at onRunComplete', async () => {
    const fetchImpl = makeFetch({});
    await run([{ fullName: 'checkout smoke', ciKey: 'checkout.smoke', duration: 42 }], {
      fetchImpl,
    });

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
    await run(
      [
        { fullName: 'kept', ciKey: 'kept' },
        { fullName: 'untagged' }, // no tag
        { fullName: 'empty', ciKey: '' }, // empty → untagged
      ],
      { fetchImpl },
    );
    const body = bodyOf(fetchImpl);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].ciKey).toBe('kept');
  });

  it('maps Jest statuses to the server enum', async () => {
    const fetchImpl = makeFetch({});
    await run(
      [
        { fullName: 'p', ciKey: 'k.pass', status: 'passed' },
        { fullName: 'f', ciKey: 'k.fail', status: 'failed' },
        { fullName: 's', ciKey: 'k.skip', status: 'pending' },
        { fullName: 'x', ciKey: 'k.broken', status: 'focused' },
      ],
      { fetchImpl },
    );
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

  it('scopes tags by file — the same test name in two files both submit (no collision)', async () => {
    const fetchImpl = makeFetch({});
    await run(
      [
        { fullName: 'smoke runs', file: '/repo/a.test.ts', ciKey: 'a.smoke', status: 'passed' },
        { fullName: 'smoke runs', file: '/repo/b.test.ts', ciKey: 'b.smoke', status: 'failed' },
      ],
      { fetchImpl },
    );
    const byKey = Object.fromEntries(
      bodyOf(fetchImpl).results.map((r: { ciKey: string; status: string }) => [r.ciKey, r.status]),
    );
    expect(byKey).toEqual({ 'a.smoke': 'passed', 'b.smoke': 'failed' });
  });

  it('records a duplicate ci_key predictably (submits both entries, server dedupes)', async () => {
    const fetchImpl = makeFetch({});
    await run(
      [
        { fullName: 'one', ciKey: 'dup.key', status: 'passed' },
        { fullName: 'two', ciKey: 'dup.key', status: 'failed' },
      ],
      { fetchImpl },
    );
    const body = bodyOf(fetchImpl);
    expect(body.results).toHaveLength(2);
    expect(body.results.every((r: { ciKey: string }) => r.ciKey === 'dup.key')).toBe(true);
  });

  it('omits reportedAt — Jest exposes no per-test timestamp', async () => {
    const fetchImpl = makeFetch({});
    await run([{ fullName: 't', ciKey: 'k' }], { fetchImpl });
    expect(bodyOf(fetchImpl).results[0]).not.toHaveProperty('reportedAt');
  });

  it('skips submission (warns) when no commit resolves', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    await run([{ fullName: 't', ciKey: 'k' }], {
      env: { NOHOTFIX_INGEST_TOKEN: 't', NOHOTFIX_ENVIRONMENT: 'e' }, // no GITHUB_SHA
      fetchImpl,
      logger,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.some((l) => l.level === 'warn' && /NOHOTFIX_COMMIT/.test(l.msg))).toBe(true);
  });

  it('logs a clear error and does not submit when config is missing', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    await run([{ fullName: 't', ciKey: 'k' }], { env: {}, fetchImpl, logger });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.some((l) => l.level === 'error' && /misconfigured/.test(l.msg))).toBe(true);
  });

  it('does nothing (no error) when there are no tagged tests', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    await run([{ fullName: 't' }], { fetchImpl, logger });
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
    await run([{ fullName: 't', ciKey: 'typo.key' }], { fetchImpl, logger });
    expect(lines.some((l) => /typo\.key.*unknown_ci_key/.test(l.msg))).toBe(true);
  });
});

// ── US2: never breaks the build ────────────────────────────────────────────────
describe('NoHotfixReporter (US2 — never breaks the build)', () => {
  const oneTagged = (): Case[] => [{ fullName: 't', ciKey: 'k' }];

  it('fails clearly (exit 1) on a 401 bad token', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 401 });
    const { logger, lines } = makeLogger();
    const setExitCode = vi.fn();
    await run(oneTagged(), { fetchImpl, logger, setExitCode });
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(lines.some((l) => l.level === 'error' && /token/.test(l.msg))).toBe(true);
  });

  it('fails clearly (exit 1) on a 403 forbidden', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 403 });
    const setExitCode = vi.fn();
    await run(oneTagged(), { fetchImpl, setExitCode });
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it('fails clearly (exit 1) on a 400 malformed payload', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 400 });
    const setExitCode = vi.fn();
    await run(oneTagged(), { fetchImpl, setExitCode });
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it('does NOT touch the exit code on a 5xx (warns instead)', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 500 });
    const { logger, lines } = makeLogger();
    const setExitCode = vi.fn();
    await run(oneTagged(), { fetchImpl, logger, setExitCode, retries: 0 });
    expect(setExitCode).not.toHaveBeenCalled();
    expect(lines.some((l) => l.level === 'warn' && /not affected/.test(l.msg))).toBe(true);
  });

  it('does NOT touch the exit code on a 429', async () => {
    const fetchImpl = makeFetch({ ok: false, status: 429 });
    const setExitCode = vi.fn();
    await run(oneTagged(), { fetchImpl, setExitCode });
    expect(setExitCode).not.toHaveBeenCalled();
  });

  it('does NOT touch the exit code on a network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as ReturnType<typeof makeFetch>;
    const setExitCode = vi.fn();
    await run(oneTagged(), { fetchImpl, setExitCode, retries: 0 });
    expect(setExitCode).not.toHaveBeenCalled();
  });
});

// ── US3: shard-safe, idempotent submissions ────────────────────────────────────
describe('NoHotfixReporter (US3 — sharding)', () => {
  const oneTagged = (): Case[] => [{ fullName: 't', ciKey: 'k' }];

  function idempotencyKeyOf(fetchImpl: ReturnType<typeof makeFetch>): string {
    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    return headers['idempotency-key']!;
  }

  it('uses the Jest --shard identity (globalConfig.shard.shardIndex) with the "jest" reporter name', async () => {
    const fetchImpl = makeFetch({});
    await run(oneTagged(), { fetchImpl, globalConfig: { shard: { shardIndex: 3 } } });
    expect(idempotencyKeyOf(fetchImpl)).toBe(
      buildIdempotencyKey({
        commit: 'abc123',
        environment: 'production',
        reporterName: 'jest',
        shardSuffix: '3',
      }),
    );
  });

  it('JEST_SHARD_INDEX overrides the parsed --shard', async () => {
    const fetchImpl = makeFetch({});
    await run(oneTagged(), {
      fetchImpl,
      env: { ...baseEnv, JEST_SHARD_INDEX: '7' },
      globalConfig: { shard: { shardIndex: 3 } },
    });
    expect(idempotencyKeyOf(fetchImpl)).toBe(
      buildIdempotencyKey({
        commit: 'abc123',
        environment: 'production',
        reporterName: 'jest',
        shardSuffix: '7',
      }),
    );
  });

  it('defaults the shard suffix to 0 when unsharded', async () => {
    const fetchImpl = makeFetch({});
    await run(oneTagged(), { fetchImpl });
    expect(idempotencyKeyOf(fetchImpl)).toBe(
      buildIdempotencyKey({
        commit: 'abc123',
        environment: 'production',
        reporterName: 'jest',
        shardSuffix: '0',
      }),
    );
  });
});

// ── US4: honest, observable output + dry-run ───────────────────────────────────
describe('NoHotfixReporter (US4 — feedback + dry-run)', () => {
  const oneTagged = (): Case[] => [
    { fullName: 'checkout smoke', ciKey: 'checkout.smoke', duration: 9 },
  ];

  it('prints a per-test disposition line after a real submission', async () => {
    const fetchImpl = makeFetch({});
    const { logger, lines } = makeLogger();
    await run(oneTagged(), { fetchImpl, logger });
    expect(lines.some((l) => /checkout\.smoke.*passed/.test(l.msg))).toBe(true);
  });

  it('writes the disposition to $GITHUB_STEP_SUMMARY in Actions', async () => {
    const fetchImpl = makeFetch({});
    const files: string[] = [];
    const reporter = new NoHotfixReporter(
      {},
      {
        env: { ...baseEnv, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: '/tmp/s.md' },
        fetchImpl,
        logger: makeLogger().logger,
        appendFile: (_p, data) => files.push(data),
        readTags: () => records(oneTagged()),
        clearTags: () => {},
      },
    );
    reporter.onRunStart();
    await reporter.onRunComplete(new Set(), aggOf(oneTagged()));
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
    }) as unknown as ReturnType<typeof makeFetch>;
    const { logger, lines } = makeLogger();
    await run(oneTagged(), { fetchImpl, env: { ...baseEnv, NOHOTFIX_DRY_RUN: 'true' }, logger });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('/api/ci/ping');
    expect(lines.some((l) => /DRY RUN — nothing was submitted/.test(l.msg))).toBe(true);
    expect(lines.some((l) => /Acme/.test(l.msg))).toBe(true);
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────────
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
    await run([{ fullName: 't', ciKey: 'k' }], { fetchImpl, logger, setExitCode });
    expect(setExitCode).not.toHaveBeenCalled();
    expect(lines.some((l) => /Submitted 1 result/.test(l.msg))).toBe(true);
  });

  it('omits durationMs when the duration is 0', async () => {
    const fetchImpl = makeFetch({});
    await run([{ fullName: 't', ciKey: 'k', status: 'pending', duration: 0 }], { fetchImpl });
    expect(bodyOf(fetchImpl).results[0]).not.toHaveProperty('durationMs');
  });

  it('emits a payload that is byte-for-byte the 056 contract (coexists with JUnit/Action paths)', async () => {
    const fetchImpl = makeFetch({});
    await run([{ fullName: 'a b c', ciKey: 'a.b.c', status: 'failed', duration: 7 }], {
      fetchImpl,
    });
    const body = bodyOf(fetchImpl);
    expect(Object.keys(body).sort()).toEqual(['commit', 'environment', 'results']);
    // reportedAt is intentionally absent for Jest (no per-test timestamp in AssertionResult).
    expect(Object.keys(body.results[0]).sort()).toEqual(['ciKey', 'durationMs', 'status']);
  });
});
