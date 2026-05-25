#!/usr/bin/env node

/**
 * @file Update package versions from semantic commits in a git range.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ZERO_SHA = /^0+$/;
const RELEASE_TYPES = new Set(['major', 'minor', 'patch']);
const semanticReleaseConfig = {
  preset: 'angular',
  parserOpts: {
    noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING'],
  },
};

const logger = {
  log: () => {},
};

/**
 * Determine whether a git SHA is the all-zero value used for new refs.
 *
 * @param {string} value - Git SHA value.
 * @returns {boolean} TRUE when the value is empty or all zeroes.
 */
export function isZeroSha(value) {
  return !value || ZERO_SHA.test(value);
}

/**
 * Build the git revision range used by a develop push event.
 *
 * @param {string} from - Previous SHA from the push event.
 * @param {string} to - Current SHA from the push event.
 * @returns {string} Git revision or revision range.
 */
export function buildCommitRange(from, to = 'HEAD') {
  return isZeroSha(from) ? to : `${from}..${to}`;
}

/**
 * Parse git log output into semantic-release commit objects.
 *
 * @param {string} output - Git log output using record and field separators.
 * @returns {{hash: string, message: string}[]} Parsed commits.
 */
export function parseGitLog(output) {
  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const separator = record.indexOf('\0');

      return {
        hash: record.slice(0, separator).trim(),
        message: record.slice(separator + 1).trim(),
      };
    })
    .filter(({ hash, message }) => hash && message);
}

/**
 * Read commits from a git revision range.
 *
 * @param {{cwd: string, from?: string, to?: string}} options - Git options.
 * @returns {{hash: string, message: string}[]} Commit objects.
 */
export function getCommitsInRange({ cwd, from, to = 'HEAD' }) {
  const range = buildCommitRange(from, to);
  const output = execFileSync('git', ['log', '--format=%x1e%H%x00%B', range], {
    cwd,
    encoding: 'utf8',
  });

  return parseGitLog(output);
}

/**
 * Analyze commits with the same conventional rules as semantic-release.
 *
 * @param {{hash: string, message: string}[]} commits - Commits to analyze.
 * @param {string} cwd - Repository working directory.
 * @returns {Promise<string|null>} Release type or null when no bump is needed.
 */
export async function analyzeReleaseType(commits, cwd) {
  const { analyzeCommits } = await import('@semantic-release/commit-analyzer');

  return analyzeCommits(semanticReleaseConfig, {
    commits,
    cwd,
    logger,
  });
}

/**
 * Increment a semver version by a release type.
 *
 * @param {string} version - Current package version.
 * @param {string} releaseType - semantic-release release type.
 * @returns {string} Next package version.
 */
export function incrementVersion(version, releaseType) {
  if (!RELEASE_TYPES.has(releaseType)) {
    throw new Error(`Unsupported release type: ${releaseType}`);
  }

  const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported package version: ${version}`);
  }

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (releaseType === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  }

  if (releaseType === 'minor') {
    minor += 1;
    patch = 0;
  }

  if (releaseType === 'patch') {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
}

/**
 * Update package metadata objects with a new version.
 *
 * @param {Object} packageJson - Parsed package.json data.
 * @param {Object} packageLock - Parsed package-lock.json data.
 * @param {string} nextVersion - Version to apply.
 * @returns {{packageJson: Object, packageLock: Object}} Updated package data.
 */
export function updatePackageVersions(packageJson, packageLock, nextVersion) {
  packageJson.version = nextVersion;
  packageLock.version = nextVersion;

  if (packageLock.packages?.['']) {
    packageLock.packages[''].version = nextVersion;
  }

  return {
    packageJson,
    packageLock,
  };
}

/**
 * Read a JSON file from disk.
 *
 * @param {string} filePath - JSON file path.
 * @returns {Object} Parsed JSON.
 */
function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/**
 * Write formatted JSON to disk.
 *
 * @param {string} filePath - JSON file path.
 * @param {Object} data - JSON data.
 */
function writeJson(filePath, data) {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Update package files when semantic commits in a range require a bump.
 *
 * @param {{cwd: string, from?: string, to?: string}} options - Runtime options.
 * @returns {Promise<{changed: boolean, releaseType: string|null, version?: string}>}
 *   Result metadata.
 */
export async function runVersionBump({ cwd, from, to = 'HEAD' }) {
  const commits = getCommitsInRange({ cwd, from, to });
  const releaseType = await analyzeReleaseType(commits, cwd);

  if (!releaseType) {
    console.log('No semantic version bump detected.');
    return {
      changed: false,
      releaseType: null,
    };
  }

  const packageJsonPath = resolve(cwd, 'package.json');
  const packageLockPath = resolve(cwd, 'package-lock.json');
  const packageJson = readJson(packageJsonPath);
  const packageLock = readJson(packageLockPath);
  const currentVersion = packageJson.version;
  const nextVersion = incrementVersion(currentVersion, releaseType);

  updatePackageVersions(packageJson, packageLock, nextVersion);
  writeJson(packageJsonPath, packageJson);
  writeJson(packageLockPath, packageLock);

  console.log(
    `Updated package.json and package-lock.json from ${currentVersion} to ${nextVersion}.`,
  );

  return {
    changed: true,
    releaseType,
    version: nextVersion,
  };
}

if (process.argv[1]?.split(/[\\/]/).pop() === 'bump-version-from-commits.js') {
  runVersionBump({
    cwd: process.cwd(),
    from: process.argv[2] || process.env.GITHUB_EVENT_BEFORE,
    to: process.argv[3] || process.env.GITHUB_SHA || 'HEAD',
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
