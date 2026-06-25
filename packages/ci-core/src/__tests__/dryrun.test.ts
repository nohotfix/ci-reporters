import { describe, expect, it, vi } from 'vitest';
import { ping } from '../transport.js';
import type { ReporterConfig } from '../types.js';

const config: ReporterConfig = {
  token: 'nhf_t',
  environment: 'production',
  apiUrl: 'https://api.nohotfix.com',
  commitOverride: null,
  dryRun: true,
};

function pingRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('ping (dry-run credential validation, FR-015)', () => {
  it('hits GET /api/ci/ping with the Bearer token and reports the org', async () => {
    const fetchImpl = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) =>
      pingRes(200, { ok: true, org: { slug: 'acme', name: 'Acme' } }),
    );
    const outcome = await ping(config, { fetchImpl });
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/Acme/);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/api/ci/ping');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer nhf_t' });
  });

  it('passes ?ciKey and reports whether it is recognized', async () => {
    const fetchImpl = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) =>
      pingRes(200, {
        ok: true,
        org: { slug: 'a', name: 'A' },
        ciKey: { value: 'k', recognized: false },
      }),
    );
    const outcome = await ping(config, { fetchImpl, ciKey: 'k' });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('ciKey=k');
    expect(outcome.message).toMatch(/NOT recognized/);
  });

  it('reports a rejected credential on 401 (without throwing)', async () => {
    const fetchImpl = vi.fn(async () => pingRes(401, {}));
    const outcome = await ping(config, { fetchImpl });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/NOHOTFIX_INGEST_TOKEN/);
  });

  it('reports unreachable on a network error (without throwing)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const outcome = await ping(config, { fetchImpl });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/could not reach/);
  });
});
