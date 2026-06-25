import { appendFileSync } from 'node:fs';
import type { CiResultInput, IngestionDisposition } from './types.js';

/** One rendered row of the per-test disposition (FR-013). */
export interface SummaryLine {
  ciKey: string;
  status: string;
  durationMs?: number;
  /** `accepted` applied to the library/run; `ignored` rejected with reason; `pending` = dry-run. */
  disposition: 'accepted' | 'ignored' | 'pending';
  reason?: string;
}

/**
 * Build the per-test disposition rows by matching submitted results against the server's
 * ignored set. In dry-run nothing was submitted, so every row is `pending`.
 */
export function buildSummaryLines(
  results: CiResultInput[],
  disposition: IngestionDisposition | null,
  opts: { pending?: boolean } = {},
): SummaryLine[] {
  const ignored = new Map((disposition?.ignored ?? []).map((i) => [i.ciKey, i.reason]));
  return results.map((r) => {
    if (opts.pending) {
      return { ciKey: r.ciKey, status: r.status, durationMs: r.durationMs, disposition: 'pending' };
    }
    const reason = ignored.get(r.ciKey);
    return {
      ciKey: r.ciKey,
      status: r.status,
      durationMs: r.durationMs,
      disposition: reason ? 'ignored' : 'accepted',
      reason,
    };
  });
}

const GLYPH: Record<SummaryLine['disposition'], string> = {
  accepted: '✓',
  ignored: '↷',
  pending: '·',
};

function duration(ms?: number): string {
  return ms === undefined ? '' : `${ms}ms`;
}

export interface SummaryContext {
  apiUrl: string;
  dryRun: boolean;
  lines: SummaryLine[];
  warnings: string[];
  /** The dry-run credential check, when applicable. */
  ping?: { ok: boolean; message: string };
}

export interface SummaryDeps {
  info: (message: string) => void;
  warn: (message: string) => void;
  env: NodeJS.ProcessEnv;
  /** Injectable file append for the GitHub step summary (defaults to fs.appendFileSync). */
  appendFile?: (path: string, data: string) => void;
}

/** Render the disposition to the console and, in GitHub Actions, the job step summary (FR-013/FR-014). */
export function writeSummary(ctx: SummaryContext, deps: SummaryDeps): void {
  const accepted = ctx.lines.filter((l) => l.disposition === 'accepted').length;
  const ignored = ctx.lines.filter((l) => l.disposition === 'ignored').length;

  if (ctx.dryRun) {
    deps.warn(`[NoHotfix] DRY RUN — nothing was submitted; no run was touched.`);
    if (ctx.ping) deps.info(`[NoHotfix] ${ctx.ping.ok ? '✓' : '✗'} ${ctx.ping.message}`);
    deps.info(`[NoHotfix] Would submit ${ctx.lines.length} result(s) to ${ctx.apiUrl}:`);
  } else if (ctx.lines.length > 0) {
    deps.info(
      `[NoHotfix] Submitted ${ctx.lines.length} result(s) to ${ctx.apiUrl} — ` +
        `${accepted} accepted, ${ignored} ignored.`,
    );
  }

  for (const line of ctx.lines) {
    const tail = line.reason ? `  (${line.reason})` : '';
    deps.info(
      `[NoHotfix]   ${GLYPH[line.disposition]} ${line.ciKey}  ${line.status}  ${duration(line.durationMs)}${tail}`,
    );
  }
  for (const warning of ctx.warnings) {
    deps.warn(`[NoHotfix] ${warning} The test job is not affected.`);
  }

  writeStepSummary(ctx, deps, { accepted, ignored });
}

function writeStepSummary(
  ctx: SummaryContext,
  deps: SummaryDeps,
  counts: { accepted: number; ignored: number },
): void {
  if (deps.env.GITHUB_ACTIONS !== 'true') return;
  const path = deps.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  if (!ctx.dryRun && ctx.lines.length === 0) return; // nothing confirmed to tabulate

  const heading = ctx.dryRun
    ? 'NoHotfix CI results (DRY RUN — nothing submitted)'
    : 'NoHotfix CI results';
  const rows = ctx.lines
    .map(
      (l) =>
        `| \`${l.ciKey}\` | ${l.status} | ${duration(l.durationMs) || '—'} | ${l.disposition}${l.reason ? ` (${l.reason})` : ''} |`,
    )
    .join('\n');
  const md =
    `### ${heading}\n\n` +
    (ctx.ping ? `_${ctx.ping.ok ? '✓' : '✗'} ${ctx.ping.message}_\n\n` : '') +
    `**${ctx.lines.length}** result(s) → \`${ctx.apiUrl}\`` +
    (ctx.dryRun ? '' : ` — ${counts.accepted} accepted, ${counts.ignored} ignored`) +
    `\n\n| Test (ci_key) | Status | Duration | Disposition |\n|---|---|---|---|\n${rows}\n`;

  const append = deps.appendFile ?? appendFileSync;
  append(path, md);
}
