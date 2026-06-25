// VENDORED COPY of the shipped 056 request/response schema.
// Source of truth: `packages/shared/src/schemas/integrations.ts` in the nohotfix.com repo.
// This copy is the oracle for the contract test (FR-001): every payload the reporter emits
// MUST validate against `IngestResultsRequestSchema`. `zod` is a TEST-ONLY devDependency —
// it is never part of the reporter's runtime (FR-016).
//
// If the server contract changes, update this file deliberately and re-run the contract test.
import { z } from 'zod';

export const CiStatusSchema = z.enum(['passed', 'failed', 'broken', 'not_executed', 'skipped']);

export const CiResultInputSchema = z.object({
  ciKey: z.string().min(1).max(200),
  status: CiStatusSchema,
  reportedAt: z.string().datetime().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});

export const IngestResultsRequestSchema = z.object({
  commit: z.string().min(1).max(200),
  environment: z.string().min(1).max(200),
  results: z.array(CiResultInputSchema).min(1).max(2000),
});

export const IngestIgnoredReasonSchema = z.enum(['unknown_ci_key', 'archived_test']);

export const IngestionDispositionSchema = z.object({
  commit: z.string(),
  environment: z.string(),
  accepted: z.number().int().nonnegative(),
  ignored: z.array(z.object({ ciKey: z.string(), reason: IngestIgnoredReasonSchema })),
  appliedToLibrary: z.number().int().nonnegative(),
  appliedToOpenRuns: z.number().int().nonnegative(),
});
