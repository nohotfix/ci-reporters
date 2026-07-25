// The worker → main-process tag bridge. Jest's `AssertionResult` carries no custom metadata and
// tests run in worker processes separate from the reporter, so a test's `ci_key` cannot ride back
// on the result. Instead the worker-side helper (`./globals`) appends it to a per-worker `.jsonl`
// file in a deterministic temp dir; the main-process reporter clears that dir at run start and
// reads it at run end. This module is dependency-free (node builtins only) so BOTH the `./globals`
// entry and the reporter can share it without either pulling in `@nohotfix/ci-core`.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** One tagged test, keyed later by (testPath, testName). */
export interface TagRecord {
  /** Absolute spec file path (`expect.getState().testPath`). */
  testPath: string;
  /** The test's full name (`expect.getState().currentTestName` === `AssertionResult.fullName`). */
  testName: string;
  ciKey: string;
}

/**
 * The temp dir shared by the worker-side helper (writes) and the main-process reporter (reads).
 * Derived deterministically from the working directory so both agree without env plumbing.
 *
 * Caveat: two concurrent `jest` runs of the same project on one machine share this dir. In practice
 * CI shards run in separate containers (separate tmpdirs), so this is a non-issue; documented anyway.
 */
export function tagDir(cwd: string = process.cwd()): string {
  const hash = createHash('sha1').update(cwd).digest('hex').slice(0, 16);
  return join(tmpdir(), 'nhf-jest', hash);
}

/** Append a tag record to this worker's file (called from the worker/test context). */
export function writeTag(record: TagRecord, dir: string = tagDir()): void {
  mkdirSync(dir, { recursive: true });
  const worker = process.env.JEST_WORKER_ID ?? '0';
  appendFileSync(join(dir, `w-${worker}.jsonl`), `${JSON.stringify(record)}\n`);
}

/** Read every tag record written during the run (called from the reporter). Never throws. */
export function readTags(dir: string = tagDir()): TagRecord[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return []; // dir absent → no tagged tests.
  }
  const records: TagRecord[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(dir, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const r = JSON.parse(trimmed) as TagRecord;
        if (
          r &&
          typeof r.testPath === 'string' &&
          typeof r.testName === 'string' &&
          typeof r.ciKey === 'string'
        ) {
          records.push(r);
        }
      } catch {
        // skip a malformed line rather than failing the run.
      }
    }
  }
  return records;
}

/** Remove the temp dir (called at run start to clear stale files, and at run end to clean up). */
export function clearTags(dir: string = tagDir()): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort; a leftover temp dir never affects correctness (start clears it).
  }
}
