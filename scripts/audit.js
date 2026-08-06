#!/usr/bin/env node

/**
 * @file Bin entry for the combined Emulsify project readiness audit.
 */

import { resolve } from 'node:path';
import {
  createUsage,
  isCliEntrypoint,
  parseArgs as parseCliArgs,
} from './lib/cli.js';
import { DEFAULT_TWIG_THRESHOLD, runAudits } from './audit/index.js';
import { applyAuditFixes, remainingFindings } from './audit/fix.js';
import {
  formatAuditJsonErrorReport,
  formatAuditJsonReport,
  formatAuditReport,
} from './audit/report.js';

export { auditProject, runAudits } from './audit/index.js';
export {
  AUDIT_REPORT_SCHEMA_VERSION,
  createAuditJsonErrorReport,
  createAuditJsonReport,
  formatAuditJsonErrorReport,
  formatAuditJsonReport,
  formatAuditReport,
} from './audit/report.js';
export { collectProjectFiles } from './audit/lib/files.js';
export { applyAuditFixes, remainingFindings } from './audit/fix.js';
export { findCssUrlReferences } from './audit/lib/css.js';
export {
  findTwigIncludeSourceReferences,
  findTwigNamespaceReferences,
  resolvesTwigReference,
} from './audit/lib/twig.js';

const failOnValues = ['error', 'warn', 'info', 'any'];
const findingSeverities = ['error', 'warn', 'info'];
const cliFailureExitCode = 2;

/**
 * CLI usage text.
 *
 * @returns {string} Usage text.
 */
function usage() {
  return createUsage(
    'Usage: emulsify-audit [--root <dir>] [--json] [--fix] [--dry-run] [--fail-on <severity>] [--fail-on-found] [--twig-threshold <count>]',
    [
      '  --root <dir>              Project root to scan. Defaults to the current directory.',
      '  --json                    Print machine-readable JSON.',
      '  --fix                     Rewrite unambiguous CSS asset URLs to the canonical /assets/... form.',
      '  --dry-run                 With --fix, report the rewrites without touching files.',
      '  --fail-on <severity>       Exit with code 1 for error, warn, info, or any findings at that threshold.',
      '  --fail-on-found           Compatibility alias for --fail-on any.',
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
      failOn: null,
      json: false,
      help: false,
      fix: false,
      dryRun: false,
      twigThreshold: DEFAULT_TWIG_THRESHOLD,
    },
    flags: {
      '--fail-on-found': {
        key: 'failOn',
        value: 'any',
      },
      '--json': 'json',
      '--fix': 'fix',
      '--dry-run': 'dryRun',
    },
    options: {
      '--fail-on': {
        key: 'failOn',
        validate: (value) => failOnValues.includes(value),
        missingMessage: '--fail-on requires one of: error, warn, info, any.',
        invalidMessage: '--fail-on must be one of: error, warn, info, any.',
      },
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
 * Decide whether completed findings meet a configured failure threshold.
 *
 * @param {object[]} [findings=[]] - Audit findings.
 * @param {'error'|'warn'|'info'|'any'|null} [failOn=null] - Threshold.
 * @returns {boolean} TRUE when the completed scan should exit with code 1.
 */
export function shouldFailAudit(findings = [], failOn = null) {
  if (!failOn) {
    return false;
  }
  if (failOn === 'any') {
    return findings.length > 0;
  }

  const includedSeverities = {
    error: ['error'],
    warn: ['error', 'warn'],
    info: ['error', 'warn', 'info'],
  }[failOn];

  return findings.some((finding) => {
    const severity = findingSeverities.includes(finding.severity)
      ? finding.severity
      : 'warn';
    return includedSeverities?.includes(severity);
  });
}

/**
 * Print an argument failure in the requested output mode.
 *
 * @param {*} error - Argument failure.
 * @param {boolean} json - Whether JSON output was requested.
 * @returns {number} Exit code.
 */
function reportArgumentFailure(error, json) {
  if (json) {
    console.log(
      formatAuditJsonErrorReport(error, {
        code: 'invalid-arguments',
      }),
    );
  } else {
    console.error(`${error.message || error}\n\n${usage()}`);
  }

  return cliFailureExitCode;
}

/**
 * Run the CLI.
 *
 * @param {string[]} argv - CLI arguments.
 * @returns {number} Exit code.
 */
export function runCli(argv = process.argv.slice(2)) {
  const jsonRequested = argv.includes('--json');
  let options;

  try {
    options = parseArgs(argv);
    if (options.help && options.json) {
      throw new Error('--json cannot be combined with --help.');
    }
    if (options.dryRun && !options.fix) {
      throw new Error('--dry-run requires --fix.');
    }
  } catch (error) {
    return reportArgumentFailure(error, jsonRequested);
  }

  if (options.help) {
    console.log(usage());
    return 0;
  }

  try {
    const result = runAudits(options);
    let findings = result.findings;

    if (options.fix) {
      try {
        result.fixes = applyAuditFixes(findings, { dryRun: options.dryRun });
      } catch (error) {
        return reportFixFailure(error, options);
      }

      // A dry run changes nothing on disk, so nothing is subtracted. A real
      // run removed the findings it fixed from the source, so the threshold
      // must be judged on what is left.
      if (!options.dryRun) {
        findings = remainingFindings(findings, result.fixes.applied);
      }
    }

    if (options.json) {
      console.log(formatAuditJsonReport(result));
    } else {
      console.log(formatAuditReport(result));
    }

    return shouldFailAudit(findings, options.failOn) ? 1 : 0;
  } catch (error) {
    if (options.json) {
      console.log(
        formatAuditJsonErrorReport(error, {
          code: 'audit-failed',
          projectDir: resolve(options.projectDir),
        }),
      );
    } else {
      console.error(`Audit failed: ${error.message || error}`);
    }

    return cliFailureExitCode;
  }
}

/**
 * Print a failure that happened while writing fixes.
 *
 * @param {*} error - Write failure.
 * @param {object} options - Parsed CLI options.
 * @returns {number} Exit code.
 */
function reportFixFailure(error, options) {
  if (options.json) {
    console.log(
      formatAuditJsonErrorReport(error, {
        code: 'fix-failed',
        projectDir: resolve(options.projectDir),
      }),
    );
  } else {
    console.error(`Audit fix failed: ${error.message || error}`);
  }

  return cliFailureExitCode;
}

if (isCliEntrypoint(['audit.js', 'emulsify-audit'])) {
  process.exitCode = runCli();
}
