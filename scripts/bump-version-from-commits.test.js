/**
 * @file Tests for develop branch semantic version bumping.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import releaseAnalysisConfig from '../config/release-analysis.cjs';
import {
  analyzeReleaseHistory,
  incrementVersion,
  parseGitLog,
  parseReleaseTag,
  releaseRules,
  updatePackageVersions,
} from './bump-version-from-commits.js';

const bumperPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'bump-version-from-commits.js',
);

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writePackageMetadata(cwd, version) {
  writeFileSync(
    join(cwd, 'package.json'),
    `${JSON.stringify({ name: 'develop-version-fixture', version }, null, 2)}\n`,
  );
  writeFileSync(
    join(cwd, 'package-lock.json'),
    `${JSON.stringify(
      {
        name: 'develop-version-fixture',
        version,
        lockfileVersion: 3,
        packages: {
          '': {
            name: 'develop-version-fixture',
            version,
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

function readVersions(cwd) {
  const packageJson = JSON.parse(
    readFileSync(join(cwd, 'package.json'), 'utf8'),
  );
  const packageLock = JSON.parse(
    readFileSync(join(cwd, 'package-lock.json'), 'utf8'),
  );

  return [
    packageJson.version,
    packageLock.version,
    packageLock.packages[''].version,
  ];
}

function commitAll(cwd, message) {
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-m', message]);
}

function addCommit(cwd, message) {
  const path = join(cwd, `change-${Date.now()}-${Math.random()}.txt`);
  writeFileSync(path, `${message}\n`);
  commitAll(cwd, message);
}

function createReleaseRepository({ tag = 'v1.0.0' } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'emulsify-develop-version-'));
  git(cwd, ['init', '--initial-branch=main']);
  git(cwd, ['config', 'user.name', 'Release Test']);
  git(cwd, ['config', 'user.email', 'release-test@example.com']);
  writePackageMetadata(cwd, '1.0.0');
  commitAll(cwd, 'chore: establish release fixture');
  if (tag) {
    git(cwd, ['tag', tag]);
  }
  git(cwd, ['branch', 'release-base']);

  return cwd;
}

function runBumper(cwd) {
  return spawnSync(process.execPath, [bumperPath, 'release-base', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  });
}

describe('develop version bump helpers', () => {
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

  it('uses the shared semantic-release parser options', () => {
    expect(releaseAnalysisConfig.commitAnalyzerOptions).toMatchObject({
      preset: 'angular',
      releaseRules,
      parserOpts: {
        noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING'],
      },
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

describe('develop version bump history', () => {
  let cwd;

  afterEach(() => {
    if (cwd) {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('keeps a feature followed by later fixes at one minor release', async () => {
    cwd = createReleaseRepository();
    addCommit(cwd, 'feat: add public API');
    writePackageMetadata(cwd, '1.1.0');
    commitAll(cwd, 'chore(release): pre-bump minor version');
    addCommit(cwd, 'fix: repair public API');

    const result = runBumper(cwd);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      'already matches 1.1.0 (minor from v1.0.0)',
    );
    expect(readVersions(cwd)).toEqual(['1.1.0', '1.1.0', '1.1.0']);
    expect(git(cwd, ['status', '--porcelain'])).toBe('');
  });

  it('predicts one patch release from patch-only history', () => {
    cwd = createReleaseRepository();
    addCommit(cwd, 'fix: repair public API');

    const result = runBumper(cwd);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      'Updated package.json and package-lock.json from 1.0.0 to 1.0.1.',
    );
    expect(readVersions(cwd)).toEqual(['1.0.1', '1.0.1', '1.0.1']);
  });

  it('predicts a major release from a breaking change', () => {
    cwd = createReleaseRepository();
    addCommit(
      cwd,
      'feat: replace public API\n\nBREAKING CHANGE: replace the public contract',
    );

    const result = runBumper(cwd);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      'Updated package.json and package-lock.json from 1.0.0 to 2.0.0.',
    );
    expect(readVersions(cwd)).toEqual(['2.0.0', '2.0.0', '2.0.0']);
  });

  it('does not change metadata for non-release-producing history', () => {
    cwd = createReleaseRepository();
    addCommit(cwd, 'chore: update internal metadata');

    const before = [
      readFileSync(join(cwd, 'package.json'), 'utf8'),
      readFileSync(join(cwd, 'package-lock.json'), 'utf8'),
    ];
    const result = runBumper(cwd);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('No semantic version bump detected.');
    expect([
      readFileSync(join(cwd, 'package.json'), 'utf8'),
      readFileSync(join(cwd, 'package-lock.json'), 'utf8'),
    ]).toEqual(before);
  });

  it('produces no diff when package metadata already matches history', () => {
    cwd = createReleaseRepository();
    addCommit(cwd, 'fix: repair public API');
    writePackageMetadata(cwd, '1.0.1');
    commitAll(cwd, 'chore(release): pre-bump patch version');

    const result = runBumper(cwd);

    expect(result.status).toBe(0);
    expect(git(cwd, ['status', '--porcelain'])).toBe('');
  });

  it('fails clearly for malformed release tags', async () => {
    cwd = createReleaseRepository({ tag: 'v1.0.0-beta.1' });
    addCommit(cwd, 'fix: repair public API');

    await expect(
      analyzeReleaseHistory({
        cwd,
        base: 'release-base',
      }),
    ).rejects.toThrow(
      'Unsupported release tag "v1.0.0-beta.1". Expected a stable tag',
    );
    expect(() => parseReleaseTag('v1.0.0-beta.1')).toThrow(
      'Expected a stable tag',
    );
  });

  it('fails clearly when no release history is reachable', async () => {
    cwd = createReleaseRepository({ tag: null });
    addCommit(cwd, 'fix: repair public API');

    await expect(
      analyzeReleaseHistory({
        cwd,
        base: 'release-base',
      }),
    ).rejects.toThrow(
      'No semantic release tag is reachable from "release-base"',
    );
  });
});
