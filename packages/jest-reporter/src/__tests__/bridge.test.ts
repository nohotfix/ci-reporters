import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearTags, readTags, tagDir, writeTag, type TagRecord } from '../bridge.js';

// Exercises the real filesystem bridge (the reporter/contract suites inject readTags/clearTags, so
// this is the only coverage of the actual worker→main file I/O).
describe('bridge (real fs)', () => {
  let dir: string;
  const savedWorker = process.env.JEST_WORKER_ID;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nhf-jest-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedWorker === undefined) delete process.env.JEST_WORKER_ID;
    else process.env.JEST_WORKER_ID = savedWorker;
  });

  const rec = (ciKey: string, testName = 'a test', testPath = '/repo/a.test.ts'): TagRecord => ({
    testPath,
    testName,
    ciKey,
  });

  it('round-trips written records', () => {
    writeTag(rec('checkout.smoke'), dir);
    writeTag(rec('billing.retry', 'another test'), dir);
    const records = readTags(dir);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.ciKey).sort()).toEqual(['billing.retry', 'checkout.smoke']);
  });

  it('writes one file per worker id and merges them on read', () => {
    process.env.JEST_WORKER_ID = '1';
    writeTag(rec('from.worker.1'), dir);
    process.env.JEST_WORKER_ID = '2';
    writeTag(rec('from.worker.2', 'other test'), dir);
    expect(
      readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .sort(),
    ).toEqual(['w-1.jsonl', 'w-2.jsonl']);
    expect(
      readTags(dir)
        .map((r) => r.ciKey)
        .sort(),
    ).toEqual(['from.worker.1', 'from.worker.2']);
  });

  it('tolerates malformed / blank lines rather than throwing', () => {
    writeFileSync(
      join(dir, 'w-0.jsonl'),
      [
        JSON.stringify(rec('good.key')),
        'not json at all',
        '',
        JSON.stringify({ testPath: '/x', ciKey: 'missing.name' }), // missing testName → skipped
        JSON.stringify(rec('also.good', 'second')),
      ].join('\n'),
    );
    const records = readTags(dir);
    expect(records.map((r) => r.ciKey).sort()).toEqual(['also.good', 'good.key']);
  });

  it('returns [] when the dir does not exist', () => {
    expect(readTags(join(dir, 'nope'))).toEqual([]);
  });

  it('clearTags removes the dir (readTags then empty)', () => {
    writeTag(rec('k'), dir);
    expect(readTags(dir)).toHaveLength(1);
    clearTags(dir);
    expect(readTags(dir)).toEqual([]);
  });

  it('tagDir is deterministic per cwd and lives under the OS temp dir', () => {
    expect(tagDir('/some/project')).toBe(tagDir('/some/project'));
    expect(tagDir('/a')).not.toBe(tagDir('/b'));
    expect(tagDir('/some/project').startsWith(tmpdir())).toBe(true);
  });
});
