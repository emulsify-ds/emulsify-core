#!/usr/bin/env node

/**
 * @file Update package versions from complete unreleased semantic history.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import releaseAnalysisConfig from '../config/release-analysis.cjs';

const RELEASE_TAG = /^v(\d+\.\d+\.\d+)$/;
const RELEASE_TYPES = new Set(['major', 'minor', 'patch']);
const { commitAnalyzerOptions, releaseRules } = releaseAnalysisConfig;
export { releaseRules };

const logger = {
  log: () => {},
};

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
  const range = from ? `${from}..${to}` : to;
  const output = execFileSync('git', ['log', '--format=%x1e%H%x00%B', range], {
    cwd,
    encoding: 'utf8',
  });

  return parseGitLog(output);
}

/**
 * Parse the stable version from a semantic-release tag.
 *
 * @param {string} tag - Git tag.
 * @returns {string} Semantic version without its v prefix.
 */
export function parseReleaseTag(tag) {
  const match = RELEASE_TAG.exec(String(tag).trim());

  if (!match) {
    throw new Error(
      `Unsupported release tag "${tag}". Expected a stable tag such as v4.3.0.`,
    );
  }

  return match[1];
}

/**
 * Find the latest release tag reachable from a ref.
 *
 * @param {{cwd: string, base?: string}} options - Git options.
 * @returns {string} Reachable release tag.
 */
export function getLatestReleaseTag({ cwd, base = 'origin/main' }) {
  try {
    return execFileSync(
      'git',
      ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', base],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
  } catch {
    throw new Error(`No semantic release tag is reachable from "${base}".`);
  }
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

  return analyzeCommits(commitAnalyzerOptions, {
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
 * Analyze all unreleased commits from main's latest stable tag to a target.
 *
 * @param {object} options - Analysis options.
 * @param {string} options.cwd - Repository root.
 * @param {string} [options.base='origin/main'] - Ref used to find the last tag.
 * @param {string} [options.head='HEAD'] - Prospective release head.
 * @returns {Promise<object>} Release history and predicted version.
 */
export async function analyzeReleaseHistory({
  cwd,
  base = 'origin/main',
  head = 'HEAD',
}) {
  const releaseTag = getLatestReleaseTag({ cwd, base });
  const previousVersion = parseReleaseTag(releaseTag);
  const commits = getCommitsInRange({ cwd, from: releaseTag, to: head });
  const releaseType = await analyzeReleaseType(commits, cwd);

  return {
    releaseTag,
    previousVersion,
    releaseType,
    predictedVersion: releaseType
      ? incrementVersion(previousVersion, releaseType)
      : null,
    range: `${releaseTag}..${head}`,
    commits,
  };
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
 * @param {{cwd: string, base?: string, to?: string}} options - Runtime options.
 * @returns {Promise<{changed: boolean, releaseType: string|null, version?: string}>}
 *   Result metadata.
 */
export async function runVersionBump({
  cwd,
  base = 'origin/main',
  to = 'HEAD',
}) {
  const { releaseType, predictedVersion, releaseTag } =
    await analyzeReleaseHistory({
      cwd,
      base,
      head: to,
    });

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
  const nextVersion = predictedVersion;
  const versionsMatch =
    currentVersion === nextVersion &&
    packageLock.version === nextVersion &&
    packageLock.packages?.['']?.version === nextVersion;

  if (versionsMatch) {
    console.log(
      `Package metadata already matches ${nextVersion} (${releaseType} from ${releaseTag}).`,
    );
    return {
      changed: false,
      releaseType,
      version: nextVersion,
    };
  }

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
    base: process.argv[2] || process.env.RELEASE_BASE || 'origin/main',
    to: process.argv[3] || process.env.GITHUB_SHA || 'HEAD',
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
