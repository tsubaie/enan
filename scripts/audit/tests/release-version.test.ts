import { describe, expect, it } from 'vitest';
import { nextVersion, parseReleaseTag } from '../../build/release-version';

const october = new Date('2026-10-23T12:00:00Z');

describe('release versions', () => {
  it('ADMIN-B54 the first release of a month is YYYY.M.0', () => {
    expect(nextVersion(october, ['v0.1.0'], 3)).toBe('2026.10.0');
    expect(nextVersion(october, ['v0.1.0', 'v2026.9.4'], 1)).toBe('2026.10.0');
  });

  it('ADMIN-B54 a second release in the same month counts up, ignoring pre-releases', () => {
    expect(nextVersion(october, ['v2026.10.0', 'v2026.10.1', 'v2026.10.5-rc.1'], 2)).toBe(
      '2026.10.2',
    );
  });

  it('ADMIN-B54 a new year starts at YYYY.1.0, in UTC', () => {
    expect(nextVersion(new Date('2027-01-01T00:30:00Z'), ['v2026.12.3'], 1)).toBe('2027.1.0');
    expect(nextVersion(new Date('2026-12-31T23:59:00Z'), ['v2026.12.3'], 1)).toBe('2026.12.4');
  });

  it('ADMIN-B54 no merges since the last release means no release', () => {
    expect(nextVersion(october, ['v2026.10.0'], 0)).toBeNull();
  });

  it('ADMIN-B54 release.yml accepts vYYYY.M.N and refuses other tags', () => {
    expect(parseReleaseTag('v2026.10.0')).toEqual({
      year: 2026,
      month: 10,
      n: 0,
      prerelease: false,
    });
    expect(parseReleaseTag('v2026.1.12-rc.1')?.prerelease).toBe(true);
    for (const tag of ['v0.1.0', 'v2026.01.0', 'v2026.13.0', 'v2026.10.01', 'v2026.10', 'latest']) {
      expect(parseReleaseTag(tag), tag).toBeNull();
    }
  });
});
