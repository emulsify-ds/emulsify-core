#!/usr/bin/env node

/**
 * @file Predict semantic-release output without running publishing plugins.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  analyzeReleaseHistory,
  analyzeReleaseType,
  getCommitsInRange,
  parseReleaseTag,
} from './bump-version-from-commits.js';
import {
  createUsage,
  isCliEntrypoint,
  parseArgs as parseCliArgs,
} from './lib/cli.js';

export { parseReleaseTag };

/**
 * Read the package version from a project.
 *
 * @param {string} cwd - Project root.
 * @returns {string} Package version.
 */
export function readPackageVersion(cwd) {
  const packageJson = JSON.parse(
    readFileSync(resolve(cwd, 'package.json'), 'utf8'),
  );

  if (typeof packageJson.version !== 'string' || !packageJson.version) {
    throw new Error('package.json must contain a version string.');
  }

  return packageJson.version;
}

/**
 * Ensure package metadata agrees with the predicted release.
 *
 * @param {object} options - Version details.
 * @param {string} options.packageVersion - Version in package.json.
 * @param {string} options.predictedVersion - Version predicted from commits.
 * @param {string} options.releaseType - Predicted release type.
 * @param {string} options.releaseTag - Previous release tag.
 * @returns {void}
 */
export function assertPackageVersion({
  packageVersion,
  predictedVersion,
  releaseType,
  releaseTag,
}) {
  if (packageVersion !== predictedVersion) {
    throw new Error(
      `package.json version ${packageVersion} does not match the semantic-release prediction ${predictedVersion} (${releaseType} from ${releaseTag}).`,
    );
  }
}

/**
 * Ensure a possible squash commit preserves the range's release type.
 *
 * @param {object} options - Analysis details.
 * @param {string} options.squashTitle - Pull request title.
 * @param {string|null} options.squashTitleReleaseType - Title release type.
 * @param {string|null} options.squashReleaseType - Base and title release type.
 * @param {string} options.rangeReleaseType - Full range release type.
 * @returns {void}
 */
export function assertSquashReleaseType({
  squashTitle,
  squashTitleReleaseType,
  squashReleaseType,
  rangeReleaseType,
}) {
  if (!squashTitleReleaseType) {
    throw new Error(
      `Squash title "${squashTitle}" would not produce a semantic release. Use a conventional title such as "feat(scope): ..." or "fix(scope): ...".`,
    );
  }

  if (squashReleaseType !== rangeReleaseType) {
    throw new Error(
      `Squash title "${squashTitle}" predicts a ${squashReleaseType} release, but the full commit range predicts ${rangeReleaseType}.`,
    );
  }
}

/**
 * Predict the release produced by a prospective main-branch merge.
 *
 * @param {object} options - Analysis options.
 * @param {string} options.cwd - Repository root.
 * @param {string} [options.base='origin/main'] - Ref used to find the last tag.
 * @param {string} [options.head='HEAD'] - Prospective release head.
 * @param {string} [options.squashTitle] - Optional prospective squash title.
 * @returns {Promise<object>} Release prediction.
 */
export async function predictRelease({
  cwd,
  base = 'origin/main',
  head = 'HEAD',
  squashTitle,
}) {
  const {
    releaseTag,
    previousVersion,
    releaseType,
    predictedVersion,
    range,
    commits,
  } = await analyzeReleaseHistory({ cwd, base, head });

  if (!releaseType) {
    throw new Error(
      `No semantic release is predicted from ${range}. Add a release-producing conventional commit.`,
    );
  }

  const packageVersion = readPackageVersion(cwd);
  assertPackageVersion({
    packageVersion,
    predictedVersion,
    releaseType,
    releaseTag,
  });

  let squashReleaseType;
  let squashTitleReleaseType;
  if (squashTitle !== undefined) {
    const prospectiveSquashCommit = {
      hash: 'prospective-squash',
      message: squashTitle,
    };
    squashTitleReleaseType = await analyzeReleaseType(
      [prospectiveSquashCommit],
      cwd,
    );
    const baseCommits = getCommitsInRange({
      cwd,
      from: releaseTag,
      to: base,
    });
    squashReleaseType = await analyzeReleaseType(
      [...baseCommits, prospectiveSquashCommit],
      cwd,
    );
    assertSquashReleaseType({
      squashTitle,
      squashTitleReleaseType,
      squashReleaseType,
      rangeReleaseType: releaseType,
    });
  }

  return {
    releaseTag,
    previousVersion,
    releaseType,
    predictedVersion,
    packageVersion,
    range,
    commitCount: commits.length,
    ...(squashTitle === undefined
      ? {}
      : {
          squashTitle,
          squashTitleReleaseType,
          squashReleaseType,
        }),
  };
}

/**
 * Parse CLI arguments with CI environment fallbacks.
 *
 * @param {string[]} argv - CLI arguments.
 * @param {NodeJS.ProcessEnv} [env=process.env] - Environment variables.
 * @returns {object} Parsed options.
 */
export function parseArgs(argv, env = process.env) {
  return parseCliArgs(argv, {
    defaults: {
      base: env.RELEASE_FROM || env.RELEASE_BASE || 'origin/main',
      head: env.RELEASE_TO || env.RELEASE_HEAD || 'HEAD',
      squashTitle:
        env.RELEASE_SQUASH_MESSAGE ?? env.RELEASE_SQUASH_TITLE ?? undefined,
      help: false,
    },
    options: {
      '--base': {
        key: 'base',
        missingMessage: '--base requires a git ref.',
      },
      '--head': {
        key: 'head',
        missingMessage: '--head requires a git ref.',
      },
      '--squash-title': {
        key: 'squashTitle',
        missingMessage: '--squash-title requires a commit title.',
      },
    },
  });
}

/**
 * Format CLI usage.
 *
 * @returns {string} Usage text.
 */
export function usage() {
  return createUsage(
    'Usage: node scripts/verify-release-analysis.js [options]',
    [
      '  --base <ref>           Ref used to find the latest release tag.',
      '  --head <ref>           Prospective release head. Defaults to HEAD.',
      '  --squash-title <title>  Require a squash title to preserve the release type.',
      '  --help                 Print this help text.',
    ],
  );
}

/**
 * Run the release predictor CLI.
 *
 * @param {string[]} [argv] - CLI arguments.
 * @param {NodeJS.ProcessEnv} [env] - Environment variables.
 * @param {string} [cwd] - Repository root.
 * @returns {Promise<number>} Process exit code.
 */
export async function runCli(
  argv = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
) {
  try {
    const options = parseArgs(argv, env);

    if (options.help) {
      console.log(usage());
      return 0;
    }

    const prediction = await predictRelease({
      cwd,
      base: options.base,
      head: options.head,
      squashTitle: options.squashTitle,
    });

    console.log(
      `semantic-release predicts ${prediction.releaseType}: ${prediction.releaseTag} -> v${prediction.predictedVersion} from ${prediction.commitCount} commits.`,
    );
    if (prediction.squashReleaseType) {
      console.log(
        `Squash title preserves the ${prediction.squashReleaseType} release.`,
      );
    }

    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (isCliEntrypoint(['verify-release-analysis.js'])) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
