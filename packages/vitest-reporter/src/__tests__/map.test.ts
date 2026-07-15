import { describe, expect, it } from 'vitest';
import type { TestCase } from 'vitest/node';
import { mapVitestStatus, NHF_META_KEY, readCiKey, resolveShardSuffix } from '../map.js';

// A minimal TestCase double exposing only what `readCiKey` reads.
function testCaseWithMeta(meta: Record<string, unknown>): TestCase {
  return { id: 't', meta: () => meta } as unknown as TestCase;
}

describe('mapVitestStatus (D4)', () => {
  it('maps terminal Vitest states to the server enum', () => {
    expect(mapVitestStatus('passed')).toBe('passed');
    expect(mapVitestStatus('failed')).toBe('failed');
    expect(mapVitestStatus('skipped')).toBe('skipped');
    expect(mapVitestStatus('todo')).toBe('skipped');
  });

  it('maps non-terminal / unknown states to broken — never passed', () => {
    expect(mapVitestStatus('pending')).toBe('broken');
    expect(mapVitestStatus('queued')).toBe('broken');
    expect(mapVitestStatus('what-is-this')).toBe('broken');
  });
});

describe('readCiKey (FR-002 / FR-003, D3)', () => {
  it('reads the reserved nhfKey from task metadata', () => {
    expect(readCiKey(testCaseWithMeta({ [NHF_META_KEY]: 'checkout.smoke' }))).toBe(
      'checkout.smoke',
    );
  });

  it('trims the value', () => {
    expect(readCiKey(testCaseWithMeta({ [NHF_META_KEY]: '  padded.key  ' }))).toBe('padded.key');
  });

  it('treats an absent key as untagged (null)', () => {
    expect(readCiKey(testCaseWithMeta({}))).toBeNull();
    expect(readCiKey(testCaseWithMeta({ other: 'x' }))).toBeNull();
  });

  it('treats an empty / whitespace-only key as untagged (null)', () => {
    expect(readCiKey(testCaseWithMeta({ [NHF_META_KEY]: '' }))).toBeNull();
    expect(readCiKey(testCaseWithMeta({ [NHF_META_KEY]: '   ' }))).toBeNull();
  });

  it('ignores a non-string metadata value', () => {
    expect(readCiKey(testCaseWithMeta({ [NHF_META_KEY]: 42 }))).toBeNull();
  });
});

describe('resolveShardSuffix (FR-007, D5)', () => {
  it('uses Vitest --shard current index (config.shard.index)', () => {
    expect(resolveShardSuffix({}, { shard: { index: 3 } })).toBe('3');
  });

  it('VITEST_SHARD_INDEX overrides the parsed --shard', () => {
    expect(resolveShardSuffix({ VITEST_SHARD_INDEX: '7' }, { shard: { index: 3 } })).toBe('7');
  });

  it('defaults to "0" when unsharded', () => {
    expect(resolveShardSuffix({})).toBe('0');
    expect(resolveShardSuffix({}, {})).toBe('0');
  });

  it('distinct shards produce distinct suffixes; the same shard re-run is identical', () => {
    const s1 = resolveShardSuffix({}, { shard: { index: 1 } });
    const s2 = resolveShardSuffix({}, { shard: { index: 2 } });
    const s1Again = resolveShardSuffix({}, { shard: { index: 1 } });
    expect(s1).not.toBe(s2);
    expect(s1).toBe(s1Again);
  });
});
