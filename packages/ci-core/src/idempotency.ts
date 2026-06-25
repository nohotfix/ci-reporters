import { createHash } from 'node:crypto';

/** The server's per-call cap (056). Submissions beyond this are chunked. */
export const MAX_RESULTS_PER_CALL = 2000;

const NUL = '\0';

export interface IdempotencyParts {
  commit: string;
  environment: string;
  /** A stable per-reporter constant (e.g. `'playwright'`) — reproducible across versions. */
  reporterName: string;
  /** The shard identity, so distinct shards produce distinct keys. `'0'` when unsharded. */
  shardSuffix: string;
  /** Present only when a single shard's results are split across multiple chunked calls. */
  chunkIndex?: number;
}

/**
 * A content-addressed idempotency key (FR-010 / D6): `sha256(commit ⋄ environment ⋄
 * reporterName ⋄ shardSuffix [⋄ chunkN])`, hex.
 *
 * - Distinct shards → distinct keys (no collision on fan-in).
 * - A re-run of the same shard → identical key → the server no-ops (dedup).
 * - Each chunk of an oversized submission dedups independently (chunk suffix).
 */
export function buildIdempotencyKey(parts: IdempotencyParts): string {
  const segments = [parts.commit, parts.environment, parts.reporterName, parts.shardSuffix];
  if (parts.chunkIndex !== undefined) segments.push(`chunk${parts.chunkIndex}`);
  return createHash('sha256').update(segments.join(NUL)).digest('hex');
}

/** Split an array into chunks of at most `size` items (preserving order). */
export function chunk<T>(items: T[], size: number = MAX_RESULTS_PER_CALL): T[][] {
  if (size < 1) throw new Error('chunk size must be ≥ 1');
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
