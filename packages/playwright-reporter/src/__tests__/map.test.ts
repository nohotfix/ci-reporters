import { describe, expect, it } from 'vitest';
import type { FullConfig, TestCase, TestResult } from '@playwright/test/reporter';
import { mapPlaywrightStatus, NHF_ANNOTATION_TYPE, readCiKey, resolveShardSuffix } from '../map.js';

// Minimal doubles exposing only what `readCiKey` reads.
type Annotation = { type: string; description?: string };
function testCase(annotations: Annotation[]): TestCase {
  return { annotations } as unknown as TestCase;
}
function testResult(annotations: Annotation[]): TestResult {
  return { annotations } as unknown as TestResult;
}

describe('mapPlaywrightStatus', () => {
  it('maps the terminal Playwright statuses to the server enum', () => {
    expect(mapPlaywrightStatus('passed')).toBe('passed');
    expect(mapPlaywrightStatus('failed')).toBe('failed');
    expect(mapPlaywrightStatus('skipped')).toBe('skipped');
  });

  it('maps the unambiguous infra outcomes (timedOut / interrupted) to broken', () => {
    expect(mapPlaywrightStatus('timedOut')).toBe('broken');
    expect(mapPlaywrightStatus('interrupted')).toBe('broken');
  });

  it('maps any unknown status to broken — never passed', () => {
    expect(mapPlaywrightStatus('what-is-this' as TestResult['status'])).toBe('broken');
  });
});

describe('readCiKey', () => {
  it('reads the ci_key from the case-level nhf annotation', () => {
    expect(
      readCiKey(
        testCase([{ type: NHF_ANNOTATION_TYPE, description: 'checkout.smoke' }]),
        testResult([]),
      ),
    ).toBe('checkout.smoke');
  });

  it('trims the value', () => {
    expect(
      readCiKey(testCase([{ type: 'nhf', description: '  padded.key  ' }]), testResult([])),
    ).toBe('padded.key');
  });

  it('reads a runtime-pushed annotation from the result', () => {
    expect(readCiKey(testCase([]), testResult([{ type: 'nhf', description: 'runtime.key' }]))).toBe(
      'runtime.key',
    );
  });

  it('uses the first nhf annotation when several are present', () => {
    expect(
      readCiKey(
        testCase([
          { type: 'nhf', description: 'first' },
          { type: 'nhf', description: 'second' },
        ]),
        testResult([]),
      ),
    ).toBe('first');
  });

  it('ignores non-nhf annotation types', () => {
    expect(
      readCiKey(testCase([{ type: 'issue', description: 'JIRA-1' }]), testResult([])),
    ).toBeNull();
  });

  it('treats a test with no nhf annotation as untagged (null)', () => {
    expect(readCiKey(testCase([]), testResult([]))).toBeNull();
  });

  it('treats an empty / whitespace-only (or missing) description as untagged (null)', () => {
    expect(readCiKey(testCase([{ type: 'nhf', description: '   ' }]), testResult([]))).toBeNull();
    expect(readCiKey(testCase([{ type: 'nhf' }]), testResult([]))).toBeNull();
  });
});

describe('resolveShardSuffix', () => {
  it('uses the Playwright --shard current index (config.shard.current)', () => {
    expect(resolveShardSuffix({}, { shard: { current: 3, total: 5 } } as FullConfig)).toBe('3');
  });

  it('PLAYWRIGHT_SHARD_INDEX overrides the parsed --shard', () => {
    expect(
      resolveShardSuffix({ PLAYWRIGHT_SHARD_INDEX: '7' }, {
        shard: { current: 3, total: 5 },
      } as FullConfig),
    ).toBe('7');
  });

  it('defaults to "0" when unsharded', () => {
    expect(resolveShardSuffix({})).toBe('0');
    expect(resolveShardSuffix({}, {} as FullConfig)).toBe('0');
  });

  it('distinct shards produce distinct suffixes; the same shard re-run is identical', () => {
    const s1 = resolveShardSuffix({}, { shard: { current: 1, total: 2 } } as FullConfig);
    const s2 = resolveShardSuffix({}, { shard: { current: 2, total: 2 } } as FullConfig);
    const s1Again = resolveShardSuffix({}, { shard: { current: 1, total: 2 } } as FullConfig);
    expect(s1).not.toBe(s2);
    expect(s1).toBe(s1Again);
  });
});
