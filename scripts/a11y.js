#!/usr/bin/env node
/**
 * @fileoverview a11y.js
 * Runs accessibility linting (pa11y/axe) against a Storybook build
 * and reports issues.
 */

import { createReadStream, existsSync, readFileSync, statSync } from 'fs';
import { createServer } from 'http';
import path from 'path';
import { pathToFileURL } from 'url';
import pa11y from 'pa11y';

import a11yConfig from '../config/a11y.config.js';

// Project-specific configuration.
let {
  ignore = {},
  components = [],
  discoverStories = true,
  storybookBuildDir,
  pa11y: pa11yConfig = {},
} = a11yConfig;

/**
 * Resolve the project-specific accessibility config used by generated themes.
 *
 * @param {string} [projectDir=process.cwd()] - Consuming project root.
 * @returns {string} Absolute project config path.
 */
const resolveProjectA11yConfig = (projectDir = process.cwd()) =>
  path.resolve(projectDir, 'config/emulsify-core/a11y.config.js');

/**
 * Load project-specific accessibility config when a consuming project provides one.
 *
 * @returns {Promise<object>} Project accessibility config, when present.
 */
const loadProjectA11yConfig = async (projectDir = process.cwd()) => {
  const configPath = resolveProjectA11yConfig(projectDir);
  if (!existsSync(configPath)) {
    return {};
  }

  const configModule = await import(pathToFileURL(configPath).href);
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
 * @param {string} [projectDir=process.cwd()] - Consuming project root.
 * @returns {string} Absolute Storybook build directory.
 */
const resolveStorybookBuildDir = (
  buildDir = storybookBuildDir,
  projectDir = process.cwd(),
) => path.resolve(projectDir, buildDir);

/**
 * Resolve Storybook's iframe file used for per-story rendering.
 *
 * @param {string} [buildDir=storybookBuildDir] - Configured build directory.
 * @returns {string} Absolute iframe.html path.
 */
const resolveStorybookIframe = (buildDir = storybookBuildDir) =>
  path.join(resolveStorybookBuildDir(buildDir), 'iframe.html');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/**
 * Start a loopback-only server for a built Storybook.
 *
 * Storybook's module graph cannot run reliably from a file URL, so generated
 * consumers need an HTTP origin before Pa11y evaluates a story.
 *
 * @param {string} [buildDir=storybookBuildDir] - Storybook build directory.
 * @returns {Promise<{baseUrl: string, close: Function}>} Server controls.
 */
const startStorybookServer = (buildDir = storybookBuildDir) =>
  new Promise((resolve, reject) => {
    const root = resolveStorybookBuildDir(buildDir);
    const server = createServer((request, response) => {
      try {
        const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
        const requestedPath =
          decodeURIComponent(requestUrl.pathname) === '/'
            ? 'index.html'
            : decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
        const filePath = path.resolve(root, requestedPath);
        const relativePath = path.relative(root, filePath);

        if (
          !relativePath ||
          relativePath.startsWith('..') ||
          path.isAbsolute(relativePath) ||
          !existsSync(filePath) ||
          !statSync(filePath).isFile()
        ) {
          response.writeHead(404);
          response.end('Not found');
          return;
        }

        response.writeHead(200, {
          'Content-Type':
            contentTypes[path.extname(filePath)] || 'application/octet-stream',
        });
        createReadStream(filePath).pipe(response);
      } catch {
        response.writeHead(400);
        response.end('Bad request');
      }
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) =>
              error ? closeReject(error) : closeResolve(),
            );
          }),
      });
    });
  });

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
const severityToColor = (severity) =>
  ({
    error: 'red',
    warning: 'yellow',
    notice: 'blue',
  })[severity];

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
 * @param {{baseUrl?: string}} [options={}] - Storybook origin options.
 * @returns {Promise<{ issues: Pa11yIssue[], pageUrl: string }>} Pa11y result.
 */
const lintComponent = async (name, { baseUrl } = {}) =>
  pa11y(`${baseUrl || resolveStorybookIframe()}?id=${name}`, {
    includeNotices: true,
    includeWarnings: true,
    runners: ['axe'],
    ...pa11yConfig,
  });

/**
 * Lint a list of components, log reports, and exit(1) if any have issues.
 * @param {string[]} names - List of Storybook story IDs.
 * @param {{baseUrl?: string}} [options={}] - Storybook origin options.
 * @returns {Promise<void>}
 */
const lintReportAndExit = async (names, options = {}) => {
  const results = await Promise.all(
    names.map((name) => lintComponent(name, options)),
  );
  const hasIssues = results.map(logReport).some(Boolean);

  if (hasIssues) {
    process.exit(1);
  }
};

// Only perform linting/reporting when instructed via "-r".
/* istanbul ignore next */
if (['-h', '--help'].includes(process.argv[2])) {
  printHelp();
} else if (process.argv[2] === '-r') {
  loadProjectA11yConfig()
    .then(async (projectConfig) => {
      applyProjectA11yConfig(projectConfig);
      const storybookServer = await startStorybookServer();
      try {
        await lintReportAndExit(resolvePa11yStoryIds(), {
          baseUrl: `${storybookServer.baseUrl}/iframe.html`,
        });
      } finally {
        await storybookServer.close();
      }
    })
    .catch((error) => {
      console.error(error?.stack || error);
      process.exitCode = 1;
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
  resolveProjectA11yConfig,
  resolveStorybookBuildDir,
  resolveStorybookIframe,
  startStorybookServer,
  storyIdsFromStorybookIndex,
};
