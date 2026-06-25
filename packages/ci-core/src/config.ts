import type { ReporterConfig, ReporterOptions } from './types.js';

/** Thrown when required configuration (token, environment) is missing. */
export class ReporterConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReporterConfigError';
  }
}

export const DEFAULT_API_URL = 'https://api.nohotfix.com';

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}

function isTruthy(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Resolve reporter configuration from environment variables and reporter options.
 *
 * Environment variables ALWAYS take priority over options (FR-007). A missing required
 * value (token, environment) throws `ReporterConfigError` before any test work is wasted
 * (FR-006/FR-007). The CI-provider commit chain is resolved separately by `resolveCommit`.
 */
export function resolveConfig(
  env: NodeJS.ProcessEnv,
  options: ReporterOptions = {},
): ReporterConfig {
  const token = firstNonEmpty(env.NOHOTFIX_INGEST_TOKEN, options.token);
  const environment = firstNonEmpty(env.NOHOTFIX_ENVIRONMENT, options.environment);
  const apiUrl = firstNonEmpty(env.NOHOTFIX_API_URL, options.apiUrl) ?? DEFAULT_API_URL;
  const commitOverride = firstNonEmpty(env.NOHOTFIX_COMMIT, options.commit) ?? null;

  // dryRun: an explicitly-set env var wins (even when it parses to false); else the option.
  const dryRun =
    env.NOHOTFIX_DRY_RUN !== undefined ? isTruthy(env.NOHOTFIX_DRY_RUN) : (options.dryRun ?? false);

  const missing: string[] = [];
  if (!token) missing.push('token (set NOHOTFIX_INGEST_TOKEN or the `token` option)');
  if (!environment) {
    missing.push('environment (set NOHOTFIX_ENVIRONMENT or the `environment` option)');
  }
  if (missing.length > 0) {
    throw new ReporterConfigError(
      `NoHotfix reporter is misconfigured — missing ${missing.join(' and ')}.`,
    );
  }

  return {
    token: token as string,
    environment: environment as string,
    apiUrl: apiUrl.replace(/\/+$/, ''),
    commitOverride,
    dryRun,
  };
}
