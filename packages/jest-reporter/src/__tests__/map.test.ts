import { describe, expect, it } from 'vitest';
import { mapJestStatus, readCiKey, resolveShardSuffix, resultKey } from '../map.js';

describe('mapJestStatus', () => {
  it('maps the clearly terminal Jest statuses to the server enum', () => {
    expect(mapJestStatus('passed')).toBe('passed');
    expect(mapJestStatus('failed')).toBe('failed');
  });

  it('maps every intentional non-run status to skipped', () => {
    expect(mapJestStatus('skipped')).toBe('skipped');
    expect(mapJestStatus('pending')).toBe('skipped'); // it.skip / xit
    expect(mapJestStatus('todo')).toBe('skipped'); // it.todo
    expect(mapJestStatus('disabled')).toBe('skipped'); // describe.skip
  });

  it('maps focused / unknown statuses to broken — never passed', () => {
    expect(mapJestStatus('focused')).toBe('broken');
    expect(mapJestStatus('what-is-this')).toBe('broken');
  });
});

describe('resultKey', () => {
  it('is stable for the same (path, name) and distinct for different names', () => {
    expect(resultKey('/a.test.ts', 'checkout completes')).toBe(
      resultKey('/a.test.ts', 'checkout completes'),
    );
    expect(resultKey('/a.test.ts', 'x')).not.toBe(resultKey('/a.test.ts', 'y'));
  });

  it('scopes by file — the same test name in different files does not collide', () => {
    expect(resultKey('/a.test.ts', 'shared name')).not.toBe(resultKey('/b.test.ts', 'shared name'));
  });

  it('cannot collide across path/name boundaries (no join-separator ambiguity)', () => {
    expect(resultKey('/a', 'bc')).not.toBe(resultKey('/ab', 'c'));
  });
});

describe('readCiKey', () => {
  const registry = () =>
    new Map<string, string>([
      [resultKey('/checkout.test.ts', 'checkout smoke'), 'checkout.smoke'],
      [resultKey('/checkout.test.ts', 'padded'), '  padded.key  '],
      [resultKey('/checkout.test.ts', 'blank'), '   '],
    ]);

  it('reads the ci_key recorded against the (path, name)', () => {
    expect(readCiKey('/checkout.test.ts', 'checkout smoke', registry())).toBe('checkout.smoke');
  });

  it('trims the value', () => {
    expect(readCiKey('/checkout.test.ts', 'padded', registry())).toBe('padded.key');
  });

  it('treats a name recorded under a different file as untagged (null)', () => {
    expect(readCiKey('/other.test.ts', 'checkout smoke', registry())).toBeNull();
  });

  it('treats an unrecorded name as untagged (null)', () => {
    expect(readCiKey('/checkout.test.ts', 'never tagged', registry())).toBeNull();
  });

  it('treats an empty / whitespace-only key as untagged (null)', () => {
    expect(readCiKey('/checkout.test.ts', 'blank', registry())).toBeNull();
  });
});

describe('resolveShardSuffix', () => {
  it('uses Jest --shard current index (globalConfig.shard.shardIndex)', () => {
    expect(resolveShardSuffix({}, { shard: { shardIndex: 3 } })).toBe('3');
  });

  it('JEST_SHARD_INDEX overrides the parsed --shard', () => {
    expect(resolveShardSuffix({ JEST_SHARD_INDEX: '7' }, { shard: { shardIndex: 3 } })).toBe('7');
  });

  it('defaults to "0" when unsharded', () => {
    expect(resolveShardSuffix({})).toBe('0');
    expect(resolveShardSuffix({}, {})).toBe('0');
  });

  it('distinct shards produce distinct suffixes; the same shard re-run is identical', () => {
    const s1 = resolveShardSuffix({}, { shard: { shardIndex: 1 } });
    const s2 = resolveShardSuffix({}, { shard: { shardIndex: 2 } });
    const s1Again = resolveShardSuffix({}, { shard: { shardIndex: 1 } });
    expect(s1).not.toBe(s2);
    expect(s1).toBe(s1Again);
  });
});
