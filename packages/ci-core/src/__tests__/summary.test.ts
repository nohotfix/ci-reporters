import { describe, expect, it, vi } from 'vitest';
import { buildSummaryLines, writeSummary, type SummaryDeps } from '../summary.js';
import type { CiResultInput, IngestionDisposition } from '../types.js';

const results: CiResultInput[] = [
  { ciKey: 'checkout.smoke', status: 'passed', durationMs: 42 },
  { ciKey: 'typo.key', status: 'passed', durationMs: 5 },
];

const disposition: IngestionDisposition = {
  commit: 'c',
  environment: 'production',
  accepted: 1,
  ignored: [{ ciKey: 'typo.key', reason: 'unknown_ci_key' }],
  appliedToLibrary: 1,
  appliedToOpenRuns: 1,
};

function deps(
  env: NodeJS.ProcessEnv = {},
): SummaryDeps & { calls: { info: string[]; warn: string[]; files: string[] } } {
  const calls = { info: [] as string[], warn: [] as string[], files: [] as string[] };
  return {
    info: (m) => calls.info.push(m),
    warn: (m) => calls.warn.push(m),
    env,
    appendFile: (_p, data) => calls.files.push(data),
    calls,
  };
}

describe('buildSummaryLines', () => {
  it('marks an ignored key ignored and the rest accepted', () => {
    const lines = buildSummaryLines(results, disposition);
    expect(lines).toEqual([
      {
        ciKey: 'checkout.smoke',
        status: 'passed',
        durationMs: 42,
        disposition: 'accepted',
        reason: undefined,
      },
      {
        ciKey: 'typo.key',
        status: 'passed',
        durationMs: 5,
        disposition: 'ignored',
        reason: 'unknown_ci_key',
      },
    ]);
  });

  it('marks everything pending in dry-run', () => {
    const lines = buildSummaryLines(results, null, { pending: true });
    expect(lines.every((l) => l.disposition === 'pending')).toBe(true);
  });
});

describe('writeSummary (console)', () => {
  it('prints a header and a per-test disposition line each (FR-013)', () => {
    const d = deps();
    writeSummary(
      {
        apiUrl: 'https://api.nohotfix.com',
        dryRun: false,
        lines: buildSummaryLines(results, disposition),
        warnings: [],
      },
      d,
    );
    expect(d.calls.info.some((m) => /Submitted 2 result\(s\).*1 accepted, 1 ignored/.test(m))).toBe(
      true,
    );
    expect(d.calls.info.some((m) => /checkout\.smoke.*passed.*42ms/.test(m))).toBe(true);
    expect(d.calls.info.some((m) => /typo\.key.*unknown_ci_key/.test(m))).toBe(true);
  });

  it('prints warnings with the reassurance line', () => {
    const d = deps();
    writeSummary(
      {
        apiUrl: 'https://api.nohotfix.com',
        dryRun: false,
        lines: [],
        warnings: ['NoHotfix was unreachable.'],
      },
      d,
    );
    expect(d.calls.warn.some((m) => /unreachable.*not affected/s.test(m))).toBe(true);
  });
});

describe('writeSummary (GitHub step summary, FR-014)', () => {
  it('appends a markdown table when GITHUB_ACTIONS=true', () => {
    const d = deps({ GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: '/tmp/summary.md' });
    writeSummary(
      {
        apiUrl: 'https://api.nohotfix.com',
        dryRun: false,
        lines: buildSummaryLines(results, disposition),
        warnings: [],
      },
      d,
    );
    expect(d.calls.files).toHaveLength(1);
    expect(d.calls.files[0]).toMatch(/### NoHotfix CI results/);
    expect(d.calls.files[0]).toMatch(/\| `checkout\.smoke` \| passed \| 42ms \| accepted \|/);
    expect(d.calls.files[0]).toMatch(/`typo\.key`.*ignored \(unknown_ci_key\)/);
  });

  it('does NOT append outside GitHub Actions', () => {
    const d = deps({});
    writeSummary(
      { apiUrl: 'x', dryRun: false, lines: buildSummaryLines(results, disposition), warnings: [] },
      d,
    );
    expect(d.calls.files).toHaveLength(0);
  });

  it('skips the table when nothing was confirmed (no disposition, only warnings)', () => {
    const d = deps({ GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: '/tmp/s.md' });
    writeSummary({ apiUrl: 'x', dryRun: false, lines: [], warnings: ['down'] }, d);
    expect(d.calls.files).toHaveLength(0);
  });
});

describe('writeSummary (dry-run)', () => {
  it('shows the DRY RUN banner, the ping verdict, and pending rows; writes a step summary', () => {
    const d = deps({ GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: '/tmp/s.md' });
    writeSummary(
      {
        apiUrl: 'https://api.nohotfix.com',
        dryRun: true,
        lines: buildSummaryLines(results, null, { pending: true }),
        warnings: [],
        ping: { ok: true, message: 'credential valid (org: Acme)' },
      },
      d,
    );
    expect(d.calls.warn.some((m) => /DRY RUN — nothing was submitted/.test(m))).toBe(true);
    expect(d.calls.info.some((m) => /credential valid \(org: Acme\)/.test(m))).toBe(true);
    expect(d.calls.files[0]).toMatch(/DRY RUN — nothing submitted/);
  });
});
