import { describe, expect, it } from 'vitest';
import { mapStatus } from '../status.js';

describe('mapStatus', () => {
  it('maps passed → passed', () => {
    expect(mapStatus('passed')).toBe('passed');
  });

  it('maps an assertion failure → failed', () => {
    expect(mapStatus('failed')).toBe('failed');
  });

  it('maps an error/throw/timeout → broken', () => {
    expect(mapStatus('error')).toBe('broken');
  });

  it('maps skipped → skipped', () => {
    expect(mapStatus('skipped')).toBe('skipped');
  });

  it('maps an unknown/ambiguous outcome → broken (never silently passed)', () => {
    expect(mapStatus('weird-runner-state')).toBe('broken');
    expect(mapStatus('')).toBe('broken');
  });

  it('never returns not_executed (that is a server-side inference)', () => {
    const outcomes = ['passed', 'failed', 'error', 'skipped', 'unknown'];
    for (const o of outcomes) {
      expect(mapStatus(o)).not.toBe('not_executed');
    }
  });
});
