import { describe, expect, it, vi } from 'vitest';
import { buildIdempotencyKey, chunk, MAX_RESULTS_PER_CALL } from '../idempotency.js';
import { submitAll } from '../transport.js';
import type { CiResultInput, ReporterConfig, SubmitRequest } from '../types.js';

describe('buildIdempotencyKey (D6)', () => {
  const base = {
    commit: 'c1',
    environment: 'production',
    reporterName: 'playwright',
    shardSuffix: '1',
  };

  it('is a 64-char hex sha256', () => {
    expect(buildIdempotencyKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for identical inputs (a shard re-run dedups)', () => {
    expect(buildIdempotencyKey(base)).toBe(buildIdempotencyKey({ ...base }));
  });

  it('differs across shards (no fan-in collision)', () => {
    const a = buildIdempotencyKey({ ...base, shardSuffix: '1' });
    const b = buildIdempotencyKey({ ...base, shardSuffix: '2' });
    expect(a).not.toBe(b);
  });

  it('differs across commit / environment / reporter', () => {
    const keys = new Set([
      buildIdempotencyKey(base),
      buildIdempotencyKey({ ...base, commit: 'c2' }),
      buildIdempotencyKey({ ...base, environment: 'staging' }),
      buildIdempotencyKey({ ...base, reporterName: 'vitest' }),
    ]);
    expect(keys.size).toBe(4);
  });

  it('differs per chunk but is stable for the same chunk index', () => {
    const c0 = buildIdempotencyKey({ ...base, chunkIndex: 0 });
    const c1 = buildIdempotencyKey({ ...base, chunkIndex: 1 });
    expect(c0).not.toBe(c1);
    expect(c0).toBe(buildIdempotencyKey({ ...base, chunkIndex: 0 }));
    // a chunked key differs from the unchunked key
    expect(c0).not.toBe(buildIdempotencyKey(base));
  });
});

describe('chunk', () => {
  it('splits at the cap and preserves order', () => {
    const items = Array.from({ length: 4500 }, (_, i) => i);
    const chunks = chunk(items);
    expect(chunks.map((c) => c.length)).toEqual([2000, 2000, 500]);
    expect(chunks[0]![0]).toBe(0);
    expect(chunks[2]![499]).toBe(4499);
  });

  it('returns a single chunk under the cap', () => {
    expect(chunk([1, 2, 3]).length).toBe(1);
  });
});

// ── submitAll chunking + idempotency wiring ────────────────────────────────────
const config: ReporterConfig = {
  token: 't',
  environment: 'production',
  apiUrl: 'https://api.nohotfix.com',
  commitOverride: null,
  dryRun: false,
};

function dispositionFor(n: number) {
  return {
    commit: 'c1',
    environment: 'production',
    accepted: n,
    ignored: [],
    appliedToLibrary: n,
    appliedToOpenRuns: n,
  };
}

function manyResults(n: number): CiResultInput[] {
  return Array.from({ length: n }, (_, i) => ({ ciKey: `k${i}`, status: 'passed' as const }));
}

describe('submitAll', () => {
  it('submits a single call under the cap, with the base idempotency key (no chunk suffix)', async () => {
    const fetchImpl = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) => {
      return { ok: true, status: 200, json: async () => dispositionFor(3) } as unknown as Response;
    });
    const request: SubmitRequest = {
      commit: 'c1',
      environment: 'production',
      results: manyResults(3),
    };
    const result = await submitAll(config, request, {
      fetchImpl,
      sleep: async () => {},
      identity: { reporterName: 'playwright', shardSuffix: '1' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const key = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(key['idempotency-key']).toBe(
      buildIdempotencyKey({
        commit: 'c1',
        environment: 'production',
        reporterName: 'playwright',
        shardSuffix: '1',
      }),
    );
    expect(result.disposition?.accepted).toBe(3);
  });

  it('splits >2000 results into multiple calls with distinct per-chunk keys', async () => {
    const fetchImpl = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) => {
      return {
        ok: true,
        status: 200,
        json: async () => dispositionFor(2000),
      } as unknown as Response;
    });
    const request: SubmitRequest = {
      commit: 'c1',
      environment: 'production',
      results: manyResults(MAX_RESULTS_PER_CALL + 10),
    };
    const result = await submitAll(config, request, {
      fetchImpl,
      sleep: async () => {},
      identity: { reporterName: 'playwright', shardSuffix: '0' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const k0 = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const k1 = (fetchImpl.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(k0['idempotency-key']).not.toBe(k1['idempotency-key']);
    expect(result.submittedChunks).toBe(2);
  });

  it('merges dispositions across chunks', async () => {
    const fetchImpl = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) => {
      return {
        ok: true,
        status: 200,
        json: async () => dispositionFor(2000),
      } as unknown as Response;
    });
    const request: SubmitRequest = {
      commit: 'c1',
      environment: 'production',
      results: manyResults(4000),
    };
    const result = await submitAll(config, request, {
      fetchImpl,
      sleep: async () => {},
      identity: { reporterName: 'playwright', shardSuffix: '0' },
    });
    expect(result.disposition?.accepted).toBe(4000);
    expect(result.disposition?.appliedToLibrary).toBe(4000);
  });

  it('collects a warned chunk without failing the others', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) => {
      call++;
      if (call === 1)
        return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      return {
        ok: true,
        status: 200,
        json: async () => dispositionFor(2000),
      } as unknown as Response;
    });
    const request: SubmitRequest = {
      commit: 'c1',
      environment: 'production',
      results: manyResults(4000),
    };
    const result = await submitAll(config, request, {
      fetchImpl,
      sleep: async () => {},
      retries: 0,
      identity: { reporterName: 'playwright', shardSuffix: '0' },
    });
    expect(result.warnings.length).toBe(1);
    expect(result.submittedChunks).toBe(1);
    expect(result.disposition?.accepted).toBe(2000);
  });
});
