/**
 * @file Tests for non-publishing semantic-release prediction.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPackageVersion,
  assertSquashReleaseType,
  parseArgs,
  parseReleaseTag,
} from './verify-release-analysis.js';

const verifierPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'verify-release-analysis.js',
);

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writePackage(cwd, version) {
  writeFileSync(
    join(cwd, 'package.json'),
    `${JSON.stringify({ name: 'release-fixture', version }, null, 2)}\n`,
  );
}

function commitAll(cwd, message) {
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-m', message]);
}

function createReleaseRepository({
  nextMessage = 'feat: add public API',
  nextVersion = '1.1.0',
} = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'emulsify-release-analysis-'));
  git(cwd, ['init', '--initial-branch=main']);
  git(cwd, ['config', 'user.name', 'Release Test']);
  git(cwd, ['config', 'user.email', 'release-test@example.com']);

  writePackage(cwd, '1.0.0');
  commitAll(cwd, 'chore: establish release fixture');
  git(cwd, ['tag', 'v1.0.0']);
  git(cwd, ['branch', 'release-base']);

  writePackage(cwd, nextVersion);
  writeFileSync(join(cwd, 'change.txt'), `${nextMessage}\n`);
  commitAll(cwd, nextMessage);

  return cwd;
}

function runVerifier(cwd, args = []) {
  return spawnSync(
    process.execPath,
    [verifierPath, '--base', 'release-base', ...args],
    {
      cwd,
      encoding: 'utf8',
    },
  );
}

describe('release analysis verification', () => {
  let cwd;

  beforeEach(() => {
    cwd = createReleaseRepository();
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('predicts from the latest reachable tag through the prospective head', () => {
    const result = runVerifier(cwd, [
      '--squash-title',
      'feat(core): add public API',
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      'semantic-release predicts minor: v1.0.0 -> v1.1.0 from 1 commits.',
    );
    expect(result.stdout).toContain(
      'Squash title preserves the minor release.',
    );
  });

  it('rejects the current non-conventional release title', () => {
    const result = runVerifier(cwd, [
      '--squash-title',
      'Release(4.3.0): add web component stories and harden Core tooling',
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('would not produce a semantic release');
  });

  it('rejects a squash title that changes the predicted release type', () => {
    const result = runVerifier(cwd, [
      '--squash-title',
      'fix(core): patch public API',
    ]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'predicts a patch release, but the full commit range predicts minor',
    );
  });

  it('includes base-only commits when modeling a prospective squash', () => {
    rmSync(cwd, { recursive: true, force: true });
    cwd = createReleaseRepository({
      nextMessage: 'fix: patch public API',
      nextVersion: '1.1.0',
    });

    git(cwd, ['switch', 'release-base']);
    writeFileSync(join(cwd, 'base-feature.txt'), 'base feature\n');
    commitAll(cwd, 'feat: add base API');
    git(cwd, ['switch', 'main']);
    git(cwd, [
      'merge',
      '--no-ff',
      'release-base',
      '-m',
      'Merge release base into prospective head',
    ]);

    const result = runVerifier(cwd, [
      '--head',
      'main',
      '--squash-title',
      'fix(core): patch public API',
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      'semantic-release predicts minor: v1.0.0 -> v1.1.0',
    );
    expect(result.stdout).toContain(
      'Squash title preserves the minor release.',
    );
  });

  it('rejects a package version that differs from the prediction', () => {
    writePackage(cwd, '1.0.1');
    const result = runVerifier(cwd);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'package.json version 1.0.1 does not match the semantic-release prediction 1.1.0',
    );
  });

  it('rejects a range without release-producing commits', () => {
    rmSync(cwd, { recursive: true, force: true });
    cwd = createReleaseRepository({
      nextMessage: 'chore: update internal metadata',
      nextVersion: '1.0.0',
    });
    const result = runVerifier(cwd);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('No semantic release is predicted');
  });
});

describe('release analysis helpers', () => {
  it('accepts stable semantic-release tags and rejects unsupported tags', () => {
    expect(parseReleaseTag('v4.3.0')).toBe('4.3.0');
    expect(() => parseReleaseTag('4.3.0')).toThrow(
      'Expected a stable tag such as v4.3.0',
    );
    expect(() => parseReleaseTag('v4.3.0-beta.1')).toThrow(
      'Expected a stable tag such as v4.3.0',
    );
  });

  it('provides useful package-version and squash-title failures', () => {
    expect(() =>
      assertPackageVersion({
        packageVersion: '4.2.0',
        predictedVersion: '4.3.0',
        releaseType: 'minor',
        releaseTag: 'v4.2.0',
      }),
    ).toThrow('semantic-release prediction 4.3.0');

    expect(() =>
      assertSquashReleaseType({
        squashTitle: 'chore: prepare release',
        squashTitleReleaseType: null,
        squashReleaseType: null,
        rangeReleaseType: 'minor',
      }),
    ).toThrow('would not produce a semantic release');
  });

  it('uses CI environment defaults and lets CLI options override them', () => {
    const env = {
      RELEASE_FROM: 'base-from-env',
      RELEASE_TO: 'head-from-env',
      RELEASE_SQUASH_MESSAGE: 'feat: release from env',
    };

    expect(parseArgs([], env)).toMatchObject({
      base: 'base-from-env',
      head: 'head-from-env',
      squashTitle: 'feat: release from env',
    });
    expect(
      parseArgs(
        [
          '--base',
          'base-from-cli',
          '--head',
          'head-from-cli',
          '--squash-title',
          'fix: release from cli',
        ],
        env,
      ),
    ).toMatchObject({
      base: 'base-from-cli',
      head: 'head-from-cli',
      squashTitle: 'fix: release from cli',
    });
  });
});
