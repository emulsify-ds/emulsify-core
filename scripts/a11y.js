#!/usr/bin/env node
/**
 * @fileoverview a11y.js
 * Runs accessibility linting (pa11y/axe) against a Storybook build
 * and reports issues.
 */

import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as R from 'ramda';
import pa11y from 'pa11y';

import a11yConfig from '../config/a11y.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { storybookBuildDir, pa11y: pa11yConfig } = a11yConfig;

// Project-specific configuration.
let { ignore = {}, components = [] } = a11yConfig;

/** Absolute path to Storybook build directory. */
const STORYBOOK_BUILD_DIR = path.resolve(__dirname, '../', storybookBuildDir);
/** Absolute path to Storybook iframe file used for per-story rendering. */
const STORYBOOK_IFRAME = path.join(STORYBOOK_BUILD_DIR, 'iframe.html');
/** Project-specific accessibility config path used by generated themes. */
const PROJECT_A11Y_CONFIG = path.resolve(
  __dirname,
  '../../../config/emulsify-core/a11y.config.js',
);

/**
 * Load project-specific accessibility config when a consuming project provides one.
 *
 * @returns {Promise<object>} Project accessibility config, when present.
 */
const loadProjectA11yConfig = async () => {
  if (!existsSync(PROJECT_A11Y_CONFIG)) {
    return {};
  }

  const configModule = await import(pathToFileURL(PROJECT_A11Y_CONFIG).href);
  return configModule.default || configModule;
};

/**
 * Apply project-specific a11y config values over shared defaults.
 *
 * @param {{ignore?: object, components?: string[]}} config - Project config.
 * @returns {void}
 */
const applyProjectA11yConfig = (config = {}) => {
  ignore = config.ignore || ignore;
  components = config.components || components;
};

/**
 * Print CLI help.
 *
 * @returns {void}
 */
const printHelp = () => {
  // eslint-disable-next-line no-console
  console.log(
    [
      'Usage: node scripts/a11y.js [options]',
      '',
      'Options:',
      '  -r           Run pa11y against configured Storybook component IDs.',
      '  -h, --help   Print this help text.',
    ].join('\n'),
  );
};

/**
 * Map pa11y/axe severity to a label (historically a color name).
 * Retained for backward compatibility, but not used for styling anymore.
 * @deprecated Colors are no longer used; this function returns a label only.
 * @param {'error'|'warning'|'notice'} severity
 * @returns {'red'|'yellow'|'blue'|undefined}
 */
const severityToColor = R.cond([
  [R.equals('error'), R.always('red')],
  [R.equals('warning'), R.always('yellow')],
  [R.equals('notice'), R.always('blue')],
]);

/**
 * @typedef {Object} Pa11yIssue
 * @property {string} code - Rule identifier.
 * @property {'error'|'warning'|'notice'} type - Severity level.
 * @property {string} message - Human-readable description.
 * @property {string} context - HTML context snippet.
 * @property {string} selector - CSS selector for the node.
 * @property {{ description?: string }} [runnerExtras] - Extra data from the runner.
 */

/**
 * Determine whether an issue should be reported (not ignored).
 * @param {Pa11yIssue} issue
 * @returns {boolean} True if the issue is NOT ignored and should be logged.
 */
const issueIsValid = (issue) => {
  const code = issue?.code;
  const description = issue?.runnerExtras?.description;
  const codeIgnored =
    Array.isArray(ignore?.codes) && ignore.codes.includes(code);
  const descIgnored =
    description &&
    Array.isArray(ignore?.descriptions) &&
    ignore.descriptions.includes(description);
  return !(codeIgnored || descIgnored);
};

/**
 * Log a single accessibility issue in a readable, colorless block.
 * @param {Pa11yIssue} issue
 * @returns {void}
 */
const logIssue = ({ type: severity, message, context, selector }) => {
  const lines = [
    '', // leading blank for readability
    `severity: ${severity}`,
    `message: ${message}`,
    `context: ${context}`,
    `selector: ${selector}`,
    '',
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
};

/**
 * Log a report for a single component/page and return whether it had issues.
 * @param {{ issues: Pa11yIssue[], pageUrl: string }} report
 * @returns {boolean} True if the component has at least one non-ignored issue.
 */
const logReport = ({ issues, pageUrl }) => {
  const validIssues = (issues || []).filter(issueIsValid);
  const hasIssues = validIssues.length > 0;

  if (hasIssues) {
    // eslint-disable-next-line no-console
    console.log(`Issues found in component: ${pageUrl}`);
    validIssues.forEach(logIssue);
  } else {
    // eslint-disable-next-line no-console
    console.log(`No issues found in component: ${pageUrl}`);
  }

  return hasIssues;
};

/**
 * Run pa11y on a single Storybook story by its ID.
 * @param {string} name - Story ID (e.g., "components-button--primary").
 * @returns {Promise<{ issues: Pa11yIssue[], pageUrl: string }>} Pa11y result.
 */
const lintComponent = async (name) =>
  pa11y(`${STORYBOOK_IFRAME}?id=${name}`, {
    includeNotices: true,
    includeWarnings: true,
    runners: ['axe'],
    ...pa11yConfig,
  });

/**
 * Lint a list of components, log reports, and exit(1) if any have issues.
 * @param {string[]} names - List of Storybook story IDs.
 * @returns {Promise<void>}
 */
const lintReportAndExit = R.pipe(
  /** @param {string[]} list */
  (list) => list.map(lintComponent),
  (promises) => Promise.all(promises),
  R.andThen(
    R.pipe(
      /** @param {Array<{issues: Pa11yIssue[], pageUrl: string}>} results */
      (results) => results.map(logReport),
      R.reject(R.equals(false)),
      R.unless(R.isEmpty, () => process.exit(1)),
    ),
  ),
);

// Only perform linting/reporting when instructed via "-r".
/* istanbul ignore next */
if (R.includes(process.argv[2], ['-h', '--help'])) {
  printHelp();
} else if (R.pathEq(['argv', 2], '-r')(process)) {
  loadProjectA11yConfig().then((projectConfig) => {
    applyProjectA11yConfig(projectConfig);
    return lintReportAndExit(components);
  });
}

export {
  severityToColor,
  issueIsValid,
  logIssue,
  logReport,
  lintComponent,
  lintReportAndExit,
};
