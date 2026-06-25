/**
 * Commit resolution (FR-005 / D5).
 *
 * Priority: an explicit override first, then recognized CI-provider variables. If none
 * resolve, the commit is `null` and the source is `none` — the reporter then SKIPS submission
 * and emits a clear message (it MUST NOT invent a commit, e.g. from `git rev-parse HEAD`,
 * which is wrong in detached/shallow CI checkouts and silently corrupts a gate).
 */

/** Recognized CI-provider commit env vars, in priority order (covers the Tier-1 providers). */
export const COMMIT_ENV_VARS = [
  'GITHUB_SHA', // GitHub Actions
  'CI_COMMIT_SHA', // GitLab CI
  'CIRCLE_SHA1', // CircleCI
  'BUILDKITE_COMMIT', // Buildkite
] as const;

export interface CommitResolution {
  /** The resolved commit SHA, or null when nothing recognized was found. */
  commit: string | null;
  /** Where it came from: `override`, one of {@link COMMIT_ENV_VARS}, or `none`. */
  source: 'override' | (typeof COMMIT_ENV_VARS)[number] | 'none';
}

export function resolveCommit(env: NodeJS.ProcessEnv, override?: string | null): CommitResolution {
  if (override && override.trim() !== '') {
    return { commit: override.trim(), source: 'override' };
  }
  for (const name of COMMIT_ENV_VARS) {
    const value = env[name];
    if (value && value.trim() !== '') {
      return { commit: value.trim(), source: name };
    }
  }
  return { commit: null, source: 'none' };
}

/** A clear, actionable message for the unresolved-commit case (FR-005). */
export function unresolvedCommitMessage(): string {
  return (
    'NoHotfix reporter: could not resolve the commit under test from any known CI variable ' +
    `(${COMMIT_ENV_VARS.join(', ')}). Set NOHOTFIX_COMMIT explicitly. ` +
    'Skipping submission — no results were sent (the reporter never guesses a commit).'
  );
}
