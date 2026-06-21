#!/usr/bin/env node
/**
 * @fileoverview a11y.js
 * Runs accessibility linting (pa11y/axe) against a Storybook build
 * and reports issues.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as R from 'ramda';
import pa11y from 'pa11y';

import a11yConfig from '../config/a11y.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project-specific configuration.
let {
  ignore = {},
  components = [],
  discoverStories = true,
  storybookBuildDir,
  pa11y: pa11yConfig = {},
} = a11yConfig;

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
 * @param {{ignore?: object, components?: string[], discoverStories?: boolean, storybookBuildDir?: string, pa11y?: object}} config - Project config.
 * @returns {void}
 */
const applyProjectA11yConfig = (config = {}) => {
  ignore = config.ignore || ignore;
  components = Array.isArray(config.components)
    ? config.components
    : components;
  discoverStories =
    typeof config.discoverStories === 'boolean'
      ? config.discoverStories
      : discoverStories;
  storybookBuildDir =
    typeof config.storybookBuildDir === 'string' && config.storybookBuildDir
      ? config.storybookBuildDir
      : storybookBuildDir;
  pa11yConfig =
    config.pa11y && typeof config.pa11y === 'object'
      ? { ...pa11yConfig, ...config.pa11y }
      : pa11yConfig;
};

/**
 * Print CLI help.
 *
 * @returns {void}
 */
const printHelp = () => {
  console.log(
    [
      'Usage: node scripts/a11y.js [options]',
      '',
      'Options:',
      '  -r           Run pa11y against discovered and configured Storybook story IDs.',
      '  -h, --help   Print this help text.',
    ].join('\n'),
  );
};

/**
 * Resolve the configured Storybook build directory.
 *
 * @param {string} [buildDir=storybookBuildDir] - Configured build directory.
 * @returns {string} Absolute Storybook build directory.
 */
const resolveStorybookBuildDir = (buildDir = storybookBuildDir) =>
  path.resolve(__dirname, '../', buildDir);

/**
 * Resolve Storybook's iframe file used for per-story rendering.
 *
 * @param {string} [buildDir=storybookBuildDir] - Configured build directory.
 * @returns {string} Absolute iframe.html path.
 */
const resolveStorybookIframe = (buildDir = storybookBuildDir) =>
  path.join(resolveStorybookBuildDir(buildDir), 'iframe.html');

/**
 * Return unique non-empty Storybook IDs in first-seen order.
 *
 * @param {Array} values - Candidate story IDs.
 * @returns {string[]} Unique story IDs.
 */
const normalizeStoryIds = (values = []) =>
  Array.from(
    new Set(
      values
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

/**
 * Extract runnable story IDs from a Storybook index object.
 *
 * @param {object} index - Parsed Storybook index.json or stories.json.
 * @returns {string[]} Story IDs.
 */
const storyIdsFromStorybookIndex = (index = {}) => {
  const entries =
    index?.entries && typeof index.entries === 'object'
      ? index.entries
      : index?.stories && typeof index.stories === 'object'
        ? index.stories
        : {};

  return normalizeStoryIds(
    Object.entries(entries)
      .filter(([, entry]) => !entry?.type || entry.type === 'story')
      .map(([id, entry]) =>
        typeof entry?.id === 'string' && entry.id ? entry.id : id,
      ),
  );
};

/**
 * Discover runnable Storybook story IDs from built Storybook output.
 *
 * @param {string} [buildDir=storybookBuildDir] - Configured Storybook build directory.
 * @param {{warn?: Function}} [options] - Reporting options.
 * @returns {string[]} Story IDs discovered from Storybook's generated index.
 */
const discoverStoryIds = (
  buildDir = storybookBuildDir,
  { warn = console.warn } = {},
) => {
  const indexPath = path.join(resolveStorybookBuildDir(buildDir), 'index.json');

  if (!existsSync(indexPath)) {
    warn(
      `Storybook index not found at ${indexPath}; falling back to configured Pa11y story IDs.`,
    );
    return [];
  }

  try {
    return storyIdsFromStorybookIndex(
      JSON.parse(readFileSync(indexPath, 'utf8')),
    );
  } catch (error) {
    warn(
      `Unable to read Storybook index at ${indexPath}: ${
        error.message || error
      }; falling back to configured Pa11y story IDs.`,
    );
    return [];
  }
};

/**
 * Resolve the final Pa11y story ID list.
 *
 * @param {object} [options={}] - Resolution options.
 * @param {string[]} [options.manualIds=components] - Manually configured IDs.
 * @param {boolean} [options.discover=discoverStories] - Whether discovery is enabled.
 * @param {string} [options.buildDir=storybookBuildDir] - Storybook build directory.
 * @param {Function} [options.warn=console.warn] - Warning sink.
 * @returns {string[]} Story IDs to lint.
 */
const resolvePa11yStoryIds = ({
  manualIds = components,
  discover = discoverStories,
  buildDir = storybookBuildDir,
  warn = console.warn,
} = {}) => {
  const manual = normalizeStoryIds(manualIds);
  if (discover === false) return manual;

  return normalizeStoryIds([
    ...manual,
    ...discoverStoryIds(buildDir, { warn }),
  ]);
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
    console.log(`Issues found in component: ${pageUrl}`);
    validIssues.forEach(logIssue);
  } else {
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
  pa11y(`${resolveStorybookIframe()}?id=${name}`, {
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
    return lintReportAndExit(resolvePa11yStoryIds());
  });
}

export {
  severityToColor,
  applyProjectA11yConfig,
  discoverStoryIds,
  issueIsValid,
  logIssue,
  logReport,
  lintComponent,
  lintReportAndExit,
  normalizeStoryIds,
  resolvePa11yStoryIds,
  resolveStorybookBuildDir,
  resolveStorybookIframe,
  storyIdsFromStorybookIndex,
};
