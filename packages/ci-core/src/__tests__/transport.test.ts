import { describe, expect, it, vi } from 'vitest';
import { CiTransportError, submitResults } from '../transport.js';
import type { ReporterConfig, SubmitRequest } from '../types.js';

const config: ReporterConfig = {
  token: 'nhf_t',
  environment: 'production',
  apiUrl: 'https://api.nohotfix.com',
  commitOverride: null,
  dryRun: false,
};
const request: SubmitRequest = {
  commit: 'abc',
  environment: 'production',
  results: [{ ciKey: 'k', status: 'passed' }],
};

const disposition = {
  commit: 'abc',
  environment: 'production',
  accepted: 1,
  ignored: [],
  appliedToLibrary: 1,
  appliedToOpenRuns: 1,
};

function res(status: number, body: unknown = disposition): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// No real delays in tests.
const noSleep = async () => {};

describe('submitResults — resilience matrix (D8)', () => {
  it('200 → submitted with the disposition', async () => {
    const fetchImpl = vi.fn(async () => res(200));
    const outcome = await submitResults(config, request, { fetchImpl, sleep: noSleep });
    expect(outcome).toEqual({ status: 'submitted', disposition });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('200 with ignored[] → submitted (the reporter warns, does not fail)', async () => {
    const ignored = {
      ...disposition,
      accepted: 0,
      ignored: [{ ciKey: 'k', reason: 'unknown_ci_key' }],
    };
    const fetchImpl = vi.fn(async () => res(200, ignored));
    const outcome = await submitResults(config, request, { fetchImpl, sleep: noSleep });
    expect(outcome.status).toBe('submitted');
  });

  it('401 → throws CiTransportError(auth), no retry', async () => {
    const fetchImpl = vi.fn(async () => res(401));
    await expect(
      submitResults(config, request, { fetchImpl, sleep: noSleep }),
    ).rejects.toMatchObject({
      name: 'CiTransportError',
      kind: 'auth',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('403 → throws CiTransportError(auth)', async () => {
    const fetchImpl = vi.fn(async () => res(403));
    await expect(
      submitResults(config, request, { fetchImpl, sleep: noSleep }),
    ).rejects.toBeInstanceOf(CiTransportError);
  });

  it('400 → throws CiTransportError(malformed), no retry', async () => {
    const fetchImpl = vi.fn(async () => res(400));
    await expect(
      submitResults(config, request, { fetchImpl, sleep: noSleep }),
    ).rejects.toMatchObject({
      kind: 'malformed',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('429 → warned, no retry, no throw', async () => {
    const fetchImpl = vi.fn(async () => res(429));
    const outcome = await submitResults(config, request, { fetchImpl, sleep: noSleep });
    expect(outcome.status).toBe('warned');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('5xx → retries 3× then warns (4 attempts total)', async () => {
    const fetchImpl = vi.fn(async () => res(503));
    const sleeps: number[] = [];
    const outcome = await submitResults(config, request, {
      fetchImpl,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(outcome.status).toBe('warned');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it('5xx then 200 → recovers and submits', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(res(500))
      .mockResolvedValueOnce(res(200));
    const outcome = await submitResults(config, request, { fetchImpl, sleep: noSleep });
    expect(outcome.status).toBe('submitted');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('network error → retries then warns (never throws)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const outcome = await submitResults(config, request, { fetchImpl, sleep: noSleep, retries: 2 });
    expect(outcome.status).toBe('warned');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('network error then success → recovers', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('flaky DNS'))
      .mockResolvedValueOnce(res(200));
    const outcome = await submitResults(config, request, { fetchImpl, sleep: noSleep });
    expect(outcome.status).toBe('submitted');
  });

  it('an unexpected 4xx → warns (does not fail the job)', async () => {
    const fetchImpl = vi.fn(async () => res(418));
    const outcome = await submitResults(config, request, { fetchImpl, sleep: noSleep });
    expect(outcome.status).toBe('warned');
  });

  it('sends the Idempotency-Key header when provided', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      res(200),
    );
    await submitResults(config, request, { fetchImpl, sleep: noSleep, idempotencyKey: 'deadbeef' });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({ 'idempotency-key': 'deadbeef' });
  });
});
