import { describe, expect, it } from 'vitest';
import { DEFAULT_API_URL, ReporterConfigError, resolveConfig } from '../config.js';

describe('resolveConfig', () => {
  it('reads token + environment from env vars', () => {
    const config = resolveConfig({
      NOHOTFIX_INGEST_TOKEN: 'nhf_abc',
      NOHOTFIX_ENVIRONMENT: 'production',
    });
    expect(config.token).toBe('nhf_abc');
    expect(config.environment).toBe('production');
    expect(config.apiUrl).toBe(DEFAULT_API_URL);
    expect(config.commitOverride).toBeNull();
    expect(config.dryRun).toBe(false);
  });

  it('falls back to reporter options when env vars are absent', () => {
    const config = resolveConfig({}, { token: 'nhf_opt', environment: 'staging' });
    expect(config.token).toBe('nhf_opt');
    expect(config.environment).toBe('staging');
  });

  it('lets env vars win over options (FR-007)', () => {
    const config = resolveConfig(
      { NOHOTFIX_INGEST_TOKEN: 'nhf_env', NOHOTFIX_ENVIRONMENT: 'env-env' },
      { token: 'nhf_opt', environment: 'opt-env', apiUrl: 'https://opt.example' },
    );
    expect(config.token).toBe('nhf_env');
    expect(config.environment).toBe('env-env');
    // apiUrl had no env override, so the option is used.
    expect(config.apiUrl).toBe('https://opt.example');
  });

  it('strips a trailing slash from apiUrl', () => {
    const config = resolveConfig({
      NOHOTFIX_INGEST_TOKEN: 't',
      NOHOTFIX_ENVIRONMENT: 'e',
      NOHOTFIX_API_URL: 'https://self.hosted/',
    });
    expect(config.apiUrl).toBe('https://self.hosted');
  });

  it('carries the commit override from NOHOTFIX_COMMIT', () => {
    const config = resolveConfig({
      NOHOTFIX_INGEST_TOKEN: 't',
      NOHOTFIX_ENVIRONMENT: 'e',
      NOHOTFIX_COMMIT: 'deadbeef',
    });
    expect(config.commitOverride).toBe('deadbeef');
  });

  it.each(['1', 'true', 'TRUE', 'yes', 'on'])('parses NOHOTFIX_DRY_RUN=%s as truthy', (value) => {
    const config = resolveConfig({
      NOHOTFIX_INGEST_TOKEN: 't',
      NOHOTFIX_ENVIRONMENT: 'e',
      NOHOTFIX_DRY_RUN: value,
    });
    expect(config.dryRun).toBe(true);
  });

  it('treats a set-but-falsey NOHOTFIX_DRY_RUN as overriding the option to false', () => {
    const config = resolveConfig(
      { NOHOTFIX_INGEST_TOKEN: 't', NOHOTFIX_ENVIRONMENT: 'e', NOHOTFIX_DRY_RUN: 'false' },
      { dryRun: true },
    );
    expect(config.dryRun).toBe(false);
  });

  it('ignores whitespace-only env values', () => {
    expect(() =>
      resolveConfig({ NOHOTFIX_INGEST_TOKEN: '   ', NOHOTFIX_ENVIRONMENT: 'e' }),
    ).toThrow(ReporterConfigError);
  });

  it('throws a clear error when the token is missing', () => {
    expect(() => resolveConfig({ NOHOTFIX_ENVIRONMENT: 'e' })).toThrow(/token/);
  });

  it('throws a clear error when the environment is missing', () => {
    expect(() => resolveConfig({ NOHOTFIX_INGEST_TOKEN: 't' })).toThrow(/environment/);
  });

  it('names both missing values at once', () => {
    expect(() => resolveConfig({})).toThrow(/token.*environment/s);
  });
});
