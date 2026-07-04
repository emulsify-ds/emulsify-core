#!/usr/bin/env node

/**
 * @file Bin entry for the combined Emulsify project readiness audit.
 */

import {
  createUsage,
  isCliEntrypoint,
  parseArgs as parseCliArgs,
} from './lib/cli.js';
import { DEFAULT_TWIG_THRESHOLD, runAudits } from './audit/index.js';
import { formatAuditJsonReport, formatAuditReport } from './audit/report.js';

export { auditProject, runAudits } from './audit/index.js';
export { formatAuditJsonReport, formatAuditReport } from './audit/report.js';
export { collectProjectFiles } from './audit/lib/files.js';
export { findCssUrlReferences } from './audit/lib/css.js';
export {
  findTwigIncludeSourceReferences,
  findTwigNamespaceReferences,
  resolvesTwigReference,
} from './audit/lib/twig.js';

/**
 * CLI usage text.
 *
 * @returns {string} Usage text.
 */
function usage() {
  return createUsage(
    'Usage: emulsify-audit [--root <dir>] [--json] [--fail-on-found] [--twig-threshold <count>]',
    [
      '  --root <dir>              Project root to scan. Defaults to the current directory.',
      '  --json                    Print machine-readable JSON.',
      '  --fail-on-found           Exit with code 1 when any finding is reported.',
      `  --twig-threshold <count>  Warn when Storybook roots contain more than this many Twig files. Default: ${DEFAULT_TWIG_THRESHOLD}.`,
      '  --help                    Print this help text.',
    ],
  );
}

/**
 * Parse command-line arguments.
 *
 * @param {string[]} argv - CLI arguments.
 * @returns {object} Parsed options.
 */
function parseArgs(argv) {
  return parseCliArgs(argv, {
    defaults: {
      projectDir: process.cwd(),
      failOnFound: false,
      json: false,
      help: false,
      twigThreshold: DEFAULT_TWIG_THRESHOLD,
    },
    flags: {
      '--fail-on-found': 'failOnFound',
      '--json': 'json',
    },
    options: {
      '--root': {
        key: 'projectDir',
        missingMessage: '--root requires a project directory.',
      },
      '--twig-threshold': {
        key: 'twigThreshold',
        parse: Number,
        validate: Number.isFinite,
        rejectEmptyValue: false,
        rejectOptionLikeValue: false,
        missingMessage: '--twig-threshold requires a number.',
      },
    },
  });
}

/**
 * Run the CLI.
 *
 * @param {string[]} argv - CLI arguments.
 * @returns {number} Exit code.
 */
export function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(usage());
    return 0;
  }

  const result = runAudits(options);

  if (options.json) {
    console.log(formatAuditJsonReport(result));
  } else {
    console.log(formatAuditReport(result));
  }

  return options.failOnFound && result.findings.length ? 1 : 0;
}

if (isCliEntrypoint(['audit.js', 'emulsify-audit'])) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error.message || error);
    console.error('');
    console.error(usage());
    process.exitCode = 1;
  }
}
