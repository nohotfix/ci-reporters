import { describe, expect, it } from 'vitest';
import { resolveCommit, unresolvedCommitMessage } from '../commit.js';

describe('resolveCommit', () => {
  it('prefers an explicit override above all CI variables', () => {
    const r = resolveCommit({ GITHUB_SHA: 'github-sha' }, 'override-sha');
    expect(r).toEqual({ commit: 'override-sha', source: 'override' });
  });

  it('resolves GITHUB_SHA (GitHub Actions)', () => {
    expect(resolveCommit({ GITHUB_SHA: 'gh' }).commit).toBe('gh');
  });

  it('resolves CI_COMMIT_SHA (GitLab)', () => {
    expect(resolveCommit({ CI_COMMIT_SHA: 'gl' })).toEqual({
      commit: 'gl',
      source: 'CI_COMMIT_SHA',
    });
  });

  it('resolves CIRCLE_SHA1 (CircleCI)', () => {
    expect(resolveCommit({ CIRCLE_SHA1: 'circle' }).source).toBe('CIRCLE_SHA1');
  });

  it('resolves BUILDKITE_COMMIT (Buildkite)', () => {
    expect(resolveCommit({ BUILDKITE_COMMIT: 'bk' }).source).toBe('BUILDKITE_COMMIT');
  });

  it('honors the documented priority order (GitHub over GitLab)', () => {
    const r = resolveCommit({ GITHUB_SHA: 'gh', CI_COMMIT_SHA: 'gl' });
    expect(r.commit).toBe('gh');
  });

  it('returns null + source "none" when nothing resolves (never invents HEAD)', () => {
    expect(resolveCommit({})).toEqual({ commit: null, source: 'none' });
  });

  it('ignores empty/whitespace override and falls through to CI vars', () => {
    expect(resolveCommit({ GITHUB_SHA: 'gh' }, '   ').commit).toBe('gh');
    expect(resolveCommit({ GITHUB_SHA: 'gh' }, null).commit).toBe('gh');
  });

  it('trims the resolved value', () => {
    expect(resolveCommit({ GITHUB_SHA: '  abc  ' }).commit).toBe('abc');
  });

  it('the unresolved message names the override to set', () => {
    expect(unresolvedCommitMessage()).toMatch(/NOHOTFIX_COMMIT/);
  });
});
