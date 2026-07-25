import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the bridge so we assert what `tag()` extracts from `expect.getState()` — no real fs.
vi.mock('../bridge.js', () => ({ writeTag: vi.fn() }));
import { writeTag } from '../bridge.js';
import { nhf, tag } from '../globals.js';

const mockedWriteTag = vi.mocked(writeTag);

interface State {
  currentTestName?: string;
  currentConcurrentTestName?: () => string | undefined;
  testPath?: string;
}

// Temporarily install a fake `expect` global (restored before any assertion, so the test's own
// vitest `expect` is untouched) and run tag().
function runTag(state: State | undefined, ciKey: string): void {
  const g = globalThis as Record<string, unknown>;
  const saved = g.expect;
  g.expect = state === undefined ? undefined : { getState: () => state };
  try {
    tag(ciKey);
  } finally {
    g.expect = saved;
  }
}

describe('globals.tag', () => {
  beforeEach(() => mockedWriteTag.mockClear());

  it('writes the ci_key against the current test name + path', () => {
    runTag(
      { currentTestName: 'checkout completes', testPath: '/repo/a.test.ts' },
      'checkout.smoke',
    );
    expect(mockedWriteTag).toHaveBeenCalledTimes(1);
    expect(mockedWriteTag).toHaveBeenCalledWith({
      testPath: '/repo/a.test.ts',
      testName: 'checkout completes',
      ciKey: 'checkout.smoke',
    });
  });

  it('prefers the concurrent-safe name over the (possibly stale) sequential one', () => {
    runTag(
      {
        currentConcurrentTestName: () => 'concurrent test',
        currentTestName: 'stale sequential name',
        testPath: '/repo/c.test.ts',
      },
      'k',
    );
    expect(mockedWriteTag).toHaveBeenCalledTimes(1);
    expect(mockedWriteTag).toHaveBeenCalledWith({
      testPath: '/repo/c.test.ts',
      testName: 'concurrent test',
      ciKey: 'k',
    });
  });

  it('falls back to currentTestName when the concurrent getter returns undefined', () => {
    runTag(
      {
        currentConcurrentTestName: () => undefined,
        currentTestName: 'sequential test',
        testPath: '/repo/s.test.ts',
      },
      'k',
    );
    expect(mockedWriteTag.mock.calls[0]![0]).toMatchObject({ testName: 'sequential test' });
  });

  it('is a no-op when there is no active test name', () => {
    runTag({ testPath: '/repo/a.test.ts' }, 'k');
    expect(mockedWriteTag).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no test path', () => {
    runTag({ currentTestName: 'a test' }, 'k');
    expect(mockedWriteTag).not.toHaveBeenCalled();
  });

  it('is a no-op when expect is not a global (injectGlobals: false)', () => {
    runTag(undefined, 'k');
    expect(mockedWriteTag).not.toHaveBeenCalled();
  });

  it('exposes tag via the nhf namespace', () => {
    expect(nhf.tag).toBe(tag);
  });
});
