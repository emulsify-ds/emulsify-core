/**
 * @file Tests for develop branch semantic version bumping.
 */

import {
  buildCommitRange,
  incrementVersion,
  isZeroSha,
  parseGitLog,
  releaseRules,
  updatePackageVersions,
} from './bump-version-from-commits.js';

describe('develop version bump helpers', () => {
  it('detects zero SHAs from new branch push events', () => {
    expect(isZeroSha('0000000000000000000000000000000000000000')).toBe(true);
    expect(isZeroSha('abc123')).toBe(false);
  });

  it('builds a push commit range', () => {
    expect(buildCommitRange('abc123', 'def456')).toBe('abc123..def456');
    expect(
      buildCommitRange('0000000000000000000000000000000000000000', 'def456'),
    ).toBe('def456');
  });

  it('parses git log records with full commit messages', () => {
    expect(
      parseGitLog(
        '\x1eabc123\0feat: add thing\n\nBody text\n\x1edef456\0fix: patch thing\n',
      ),
    ).toEqual([
      {
        hash: 'abc123',
        message: 'feat: add thing\n\nBody text',
      },
      {
        hash: 'def456',
        message: 'fix: patch thing',
      },
    ]);
  });

  it('increments semantic versions by release type', () => {
    expect(incrementVersion('1.2.3', 'patch')).toBe('1.2.4');
    expect(incrementVersion('1.2.3', 'minor')).toBe('1.3.0');
    expect(incrementVersion('1.2.3', 'major')).toBe('2.0.0');
  });

  it('keeps the 4.x Storybook renderer migration as the major trigger', () => {
    expect(releaseRules).toContainEqual({
      type: 'feat',
      subject: 'remove storybook-html in favor of storybook-react v9.x',
      release: 'major',
    });
  });

  it('updates package and lockfile versions together', () => {
    const packageJson = { version: '1.2.3' };
    const packageLock = {
      version: '1.2.3',
      packages: {
        '': {
          version: '1.2.3',
        },
      },
    };

    expect(updatePackageVersions(packageJson, packageLock, '1.3.0')).toEqual({
      packageJson: { version: '1.3.0' },
      packageLock: {
        version: '1.3.0',
        packages: {
          '': {
            version: '1.3.0',
          },
        },
      },
    });
  });
});
