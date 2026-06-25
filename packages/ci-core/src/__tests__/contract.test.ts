import { describe, expect, it } from 'vitest';
import type { SubmitRequest } from '../types.js';
import { mapStatus } from '../status.js';
import { IngestResultsRequestSchema } from './fixtures/server-schema.js';

// FR-001: every payload the reporter emits MUST validate against the shipped 056 request
// schema. This test guards that contract WITHOUT a server change — any drift fails CI here.

describe('056 payload contract', () => {
  it('a representative SubmitRequest validates against the server schema', () => {
    const request: SubmitRequest = {
      commit: 'a'.repeat(40),
      environment: 'production',
      results: [
        { ciKey: 'checkout.new-user.complete', status: 'passed', durationMs: 1234 },
        {
          ciKey: 'billing.retry',
          status: 'failed',
          durationMs: 88,
          reportedAt: '2026-06-25T10:00:00.000Z',
        },
        { ciKey: 'auth.timeout', status: 'broken' },
        { ciKey: 'legacy.flow', status: 'skipped', durationMs: 0 },
      ],
    };
    const parsed = IngestResultsRequestSchema.safeParse(request);
    expect(parsed.success).toBe(true);
  });

  it('every status mapStatus can emit is a valid server status', () => {
    for (const outcome of ['passed', 'failed', 'error', 'skipped', 'unknown']) {
      const request: SubmitRequest = {
        commit: 'deadbeef',
        environment: 'staging',
        results: [{ ciKey: 'k', status: mapStatus(outcome) }],
      };
      expect(IngestResultsRequestSchema.safeParse(request).success).toBe(true);
    }
  });

  it('rejects an empty results array (server requires ≥1)', () => {
    const bad = { commit: 'c', environment: 'e', results: [] };
    expect(IngestResultsRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an off-contract status value', () => {
    const bad = {
      commit: 'c',
      environment: 'e',
      results: [{ ciKey: 'k', status: 'flaky' }],
    };
    expect(IngestResultsRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a ciKey over 200 chars', () => {
    const bad = {
      commit: 'c',
      environment: 'e',
      results: [{ ciKey: 'x'.repeat(201), status: 'passed' }],
    };
    expect(IngestResultsRequestSchema.safeParse(bad).success).toBe(false);
  });
});
