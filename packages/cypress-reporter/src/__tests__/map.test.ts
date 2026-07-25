import { describe, expect, it } from 'vitest';
import { mapCypressStatus, readCiKey, resolveShardSuffix, resultKey } from '../map.js';

describe('mapCypressStatus', () => {
  it('maps the clearly terminal Cypress states to the server enum', () => {
    expect(mapCypressStatus('passed')).toBe('passed');
    expect(mapCypressStatus('failed')).toBe('failed');
    expect(mapCypressStatus('pending')).toBe('skipped'); // intentional it.skip / no body
  });

  it('maps an aborted (hook-failure) "skipped" to broken — never a silent skip/pass', () => {
    expect(mapCypressStatus('skipped')).toBe('broken');
  });

  it('maps any unknown / non-terminal state to broken — never passed', () => {
    expect(mapCypressStatus('running')).toBe('broken');
    expect(mapCypressStatus('what-is-this')).toBe('broken');
  });
});

describe('resultKey', () => {
  it('is stable for the same (spec, title) and distinct for different titles', () => {
    expect(resultKey('a.cy.ts', ['checkout', 'new user'])).toBe(
      resultKey('a.cy.ts', ['checkout', 'new user']),
    );
    expect(resultKey('a.cy.ts', ['a', 'b'])).not.toBe(resultKey('a.cy.ts', ['a', 'c']));
  });

  it('scopes by spec — the same title path in different specs does not collide', () => {
    expect(resultKey('a.cy.ts', ['shared', 'title'])).not.toBe(
      resultKey('b.cy.ts', ['shared', 'title']),
    );
  });

  it('cannot collide across title-path boundaries (no join-separator ambiguity)', () => {
    expect(resultKey('s', ['foo', 'bar'])).not.toBe(resultKey('s', ['foob', 'ar']));
  });
});

describe('readCiKey', () => {
  const registry = () =>
    new Map<string, string>([
      [resultKey('checkout.cy.ts', ['checkout', 'smoke']), 'checkout.smoke'],
      [resultKey('checkout.cy.ts', ['padded']), '  padded.key  '],
      [resultKey('checkout.cy.ts', ['blank']), '   '],
    ]);

  it('reads the ci_key the plugin recorded against the spec + title path', () => {
    expect(readCiKey('checkout.cy.ts', ['checkout', 'smoke'], registry())).toBe('checkout.smoke');
  });

  it('trims the value', () => {
    expect(readCiKey('checkout.cy.ts', ['padded'], registry())).toBe('padded.key');
  });

  it('treats a title path recorded under a different spec as untagged (null)', () => {
    expect(readCiKey('other.cy.ts', ['checkout', 'smoke'], registry())).toBeNull();
  });

  it('treats an unrecorded title path as untagged (null)', () => {
    expect(readCiKey('checkout.cy.ts', ['never', 'tagged'], registry())).toBeNull();
  });

  it('treats an empty / whitespace-only key as untagged (null)', () => {
    expect(readCiKey('checkout.cy.ts', ['blank'], registry())).toBeNull();
  });
});

describe('resolveShardSuffix', () => {
  it('uses CYPRESS_SHARD_INDEX when set', () => {
    expect(resolveShardSuffix({ CYPRESS_SHARD_INDEX: '3' })).toBe('3');
    expect(resolveShardSuffix({ CYPRESS_SHARD_INDEX: '  7  ' })).toBe('7');
  });

  it('defaults to "0" when unsharded', () => {
    expect(resolveShardSuffix({})).toBe('0');
    expect(resolveShardSuffix({ CYPRESS_SHARD_INDEX: '' })).toBe('0');
  });

  it('distinct shards produce distinct suffixes; the same shard re-run is identical', () => {
    const s1 = resolveShardSuffix({ CYPRESS_SHARD_INDEX: '1' });
    const s2 = resolveShardSuffix({ CYPRESS_SHARD_INDEX: '2' });
    const s1Again = resolveShardSuffix({ CYPRESS_SHARD_INDEX: '1' });
    expect(s1).not.toBe(s2);
    expect(s1).toBe(s1Again);
  });
});
