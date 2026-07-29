#!/usr/bin/env node

/**
 * @file Report Twig component templates recognized by Emulsify Core.
 */

import { statSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';

import { resolveProjectConfig } from '../config/vite/project-config.js';
import {
  copiedComponentOutputPath,
  copiedGlobalOutputPath,
} from '../config/vite/project-structure.js';
import { walkFiles } from '../config/vite/plugins/assets/source-file-index.js';
import { toPosixPath } from '../config/vite/utils/paths.js';
import {
  createUsage,
  isCliEntrypoint,
  parseArgs as parseCliArgs,
} from './lib/cli.js';

const cliFailureExitCode = 2;

/**
 * Determine whether a path is nested below a root directory.
 *
 * @param {string} filePath - Absolute candidate path.
 * @param {string} rootDir - Absolute root directory.
 * @returns {boolean} TRUE when the candidate is below the root.
 */
function isInsideRoot(filePath, rootDir) {
  const relPath = relative(rootDir, filePath);
  return (
    Boolean(relPath) &&
    !relPath.startsWith('..') &&
    !relPath.includes(`..${sep}`)
  );
}

/**
 * Convert an absolute path to a project-relative display path when possible.
 *
 * @param {string} filePath - Absolute file or directory path.
 * @param {string} projectDir - Absolute project root.
 * @returns {string} Portable display path.
 */
function displayPath(filePath, projectDir) {
  const relPath = toPosixPath(relative(projectDir, filePath));
  return relPath.startsWith('../')
    ? toPosixPath(filePath)
    : `./${relPath || ''}`;
}

/**
 * Remove a supported Twig extension from a file name.
 *
 * @param {string} filePath - Twig template path.
 * @returns {string} Template stem.
 */
function twigStem(filePath) {
  return basename(filePath)
    .replace(/\.html\.twig$/i, '')
    .replace(/\.twig$/i, '');
}

/**
 * Create a human-readable component label.
 *
 * @param {string} name - Component machine name.
 * @returns {string} Title-cased label.
 */
function componentLabel(name) {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Remove Twig roots already covered by a parent root.
 *
 * This avoids walking `src/components` separately when the normalized Twig
 * roots already include `src`, while retaining sibling implementation roots.
 *
 * @param {string[]} roots - Absolute Twig roots.
 * @returns {string[]} Minimal roots that cover the same files.
 */
function minimalRoots(roots) {
  const uniqueRoots = Array.from(new Set(roots.map((root) => resolve(root))));

  return uniqueRoots.filter(
    (root) =>
      !uniqueRoots.some(
        (candidate) => candidate !== root && isInsideRoot(root, candidate),
      ),
  );
}

/**
 * Discover non-partial Twig templates from normalized project roots.
 *
 * @param {object} env - Normalized Emulsify project configuration.
 * @returns {string[]} Absolute Twig template paths.
 */
function collectTwigTemplates(env) {
  const roots = Array.isArray(env.projectStructure?.twigRoots)
    ? env.projectStructure.twigRoots
    : [];

  return Array.from(
    new Set(
      minimalRoots(roots).flatMap((rootDir) =>
        walkFiles(rootDir).filter(
          (filePath) =>
            /\.twig$/i.test(filePath) && !basename(filePath).startsWith('_'),
        ),
      ),
    ),
  );
}

/**
 * Assert that a selected project root exists and is a directory.
 *
 * @param {string} projectDir - Absolute project root.
 * @returns {void}
 */
function assertProjectDirectory(projectDir) {
  try {
    if (statSync(projectDir).isDirectory()) return;
  } catch {
    // Use the same concise error for missing and unreadable roots.
  }

  throw new Error(`Project root is not a readable directory: ${projectDir}`);
}

/**
 * Inspect Twig component templates recognized by Emulsify Core.
 *
 * Positional filters use case-insensitive AND matching across names, paths,
 * output locations, and template references.
 *
 * @param {{
 *   projectDir?: string,
 *   filters?: string[],
 *   env?: NodeJS.ProcessEnv|Record<string,string>
 * }} [options={}] - Inspection options.
 * @returns {{project: object, components: object[]}} Component report.
 */
export function inspectComponents(options = {}) {
  const projectDir = resolve(options.projectDir || process.cwd());
  const filters = (options.filters || [])
    .map((filter) => filter.toLowerCase().trim())
    .filter(Boolean);
  assertProjectDirectory(projectDir);

  const env = resolveProjectConfig(
    projectDir,
    options.env === undefined ? process.env : options.env,
  );
  const twigFiles = collectTwigTemplates(env);
  const componentRoot = env.namespaceRoots.components;
  const projectComponentFiles = componentRoot
    ? twigFiles.filter((filePath) => isInsideRoot(filePath, componentRoot))
    : [];
  const aliasCounts = projectComponentFiles.reduce((counts, filePath) => {
    const name = twigStem(filePath);
    counts.set(name, (counts.get(name) || 0) + 1);
    return counts;
  }, new Map());

  const components = twigFiles
    .map((filePath) => {
      const name = twigStem(filePath);
      const exactNamespaces = Object.entries(env.namespaceRoots)
        .filter(([, rootDir]) => isInsideRoot(filePath, rootDir))
        .map(
          ([namespace, rootDir]) =>
            `@${namespace}/${toPosixPath(relative(rootDir, filePath))}`,
        );
      const projectNamespace =
        env.machineName &&
        componentRoot &&
        isInsideRoot(filePath, componentRoot)
          ? `${env.machineName}:${name}`
          : null;
      const namespaces = [
        ...exactNamespaces,
        ...(projectNamespace ? [projectNamespace] : []),
      ];
      const componentOutput = copiedComponentOutputPath(
        filePath,
        env.projectStructure,
      );
      const outputPath =
        componentOutput ||
        copiedGlobalOutputPath(filePath, env.projectStructure);
      const outputRoot =
        componentOutput && env.projectStructure.mirrorComponentOutput
          ? projectDir
          : resolve(projectDir, 'dist');
      const location = outputPath
        ? displayPath(dirname(resolve(outputRoot, outputPath)), projectDir)
        : null;
      const source = displayPath(dirname(filePath), projectDir);

      return {
        label: componentLabel(name),
        name,
        namespaces,
        namespaceCollisionCount: aliasCounts.get(name) || 0,
        location,
        source,
      };
    })
    .filter((component) => {
      const haystack = [
        component.name,
        component.source,
        component.location,
        ...component.namespaces,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return filters.every((filter) => haystack.includes(filter));
    })
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.source.localeCompare(right.source),
    );

  return {
    project: {
      machineName: env.machineName || null,
      namespaceRoots: Object.fromEntries(
        Object.entries(env.namespaceRoots).map(([namespace, rootDir]) => [
          namespace,
          displayPath(rootDir, projectDir),
        ]),
      ),
      platform: env.platform,
      singleDirectoryComponents: Boolean(env.SDC),
    },
    components,
  };
}

/**
 * Format a human-readable component report.
 *
 * @param {{project: object, components: object[]}} report - Component report.
 * @returns {string} Terminal report.
 */
export function formatComponentReport(report) {
  const lines = [
    `Project: ${report.project.machineName || '(not configured)'}`,
    `Platform: ${report.project.platform}`,
    `Single Directory Components: ${
      report.project.singleDirectoryComponents ? 'enabled' : 'disabled'
    }`,
    'Namespace roots:',
  ];

  for (const [namespace, rootDir] of Object.entries(
    report.project.namespaceRoots,
  )) {
    lines.push(`- @${namespace}: ${rootDir}`);
  }

  lines.push('', `Components: ${report.components.length}`);

  const duplicateLabels = report.components.reduce((counts, component) => {
    counts.set(component.label, (counts.get(component.label) || 0) + 1);
    return counts;
  }, new Map());

  for (const component of report.components) {
    const duplicate = (duplicateLabels.get(component.label) || 0) > 1;
    const heading = duplicate
      ? `${component.label} (${component.source})`
      : component.label;
    lines.push('', `${heading}:`);

    for (const namespace of component.namespaces) {
      const collision =
        namespace.includes(':') && component.namespaceCollisionCount > 1
          ? ` (ambiguous: ${component.namespaceCollisionCount} templates)`
          : '';
      lines.push(`- Namespace: ${namespace}${collision}`);
    }

    if (component.location) {
      lines.push(`- Location: ${component.location}`);
    }
    if (component.source !== component.location) {
      lines.push(`- Source: ${component.source}`);
    }
  }

  return lines.join('\n');
}

/**
 * Parse command-line arguments while retaining positional text filters.
 *
 * @param {string[]} argv - CLI arguments.
 * @returns {{
 *   projectDir: string,
 *   filters: string[],
 *   json: boolean,
 *   help: boolean
 * }} Parsed options.
 */
function parseArgs(argv) {
  const cliArgs = [];
  const positionalFilters = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--root' || arg === '--filter') {
      cliArgs.push(arg);
      if (argv[index + 1] !== undefined) {
        cliArgs.push(argv[index + 1]);
        index += 1;
      }
      continue;
    }

    if (arg.startsWith('-')) {
      cliArgs.push(arg);
      continue;
    }

    positionalFilters.push(arg);
  }

  const options = parseCliArgs(cliArgs, {
    defaults: {
      projectDir: process.cwd(),
      filters: [],
      json: false,
      help: false,
    },
    flags: {
      '--json': 'json',
    },
    options: {
      '--filter': {
        key: 'filters',
        append: true,
        missingMessage: '--filter requires a search term.',
      },
      '--root': {
        key: 'projectDir',
        missingMessage: '--root requires a project directory.',
      },
    },
  });

  options.filters.push(...positionalFilters);
  return options;
}

/**
 * CLI usage text.
 *
 * @returns {string} Usage text.
 */
function usage() {
  return createUsage(
    'Usage: emulsify-inspect-components [filters...] [--root <dir>] [--json]',
    [
      '  filters                   Case-insensitive terms matched across component names, paths, and references.',
      '  --filter <term>           Add a filter explicitly. May be repeated.',
      '  --root <dir>              Project root to inspect. Defaults to the current directory.',
      '  --json                    Print machine-readable JSON.',
      '  --help                    Print this help text.',
    ],
  );
}

/**
 * Format a machine-readable CLI error.
 *
 * @param {Error|*} error - CLI error.
 * @param {string} code - Stable error category.
 * @returns {string} JSON error document.
 */
function formatJsonError(error, code) {
  return JSON.stringify(
    {
      error: {
        code,
        message: error?.message || String(error),
      },
    },
    null,
    2,
  );
}

/**
 * Run the component inspector CLI.
 *
 * @param {string[]} argv - CLI arguments.
 * @returns {number} Process exit code.
 */
export function runCli(argv = process.argv.slice(2)) {
  const jsonRequested = argv.includes('--json');
  let options;

  try {
    options = parseArgs(argv);
    if (options.help && options.json) {
      throw new Error('--json cannot be combined with --help.');
    }
  } catch (error) {
    if (jsonRequested) {
      console.log(formatJsonError(error, 'invalid-arguments'));
    } else {
      console.error(`${error.message || error}\n\n${usage()}`);
    }
    return cliFailureExitCode;
  }

  if (options.help) {
    console.log(usage());
    return 0;
  }

  try {
    const report = inspectComponents(options);
    console.log(
      options.json
        ? JSON.stringify(report, null, 2)
        : formatComponentReport(report),
    );
    return 0;
  } catch (error) {
    if (options.json) {
      console.log(formatJsonError(error, 'inspection-failed'));
    } else {
      console.error(`Component inspection failed: ${error.message || error}`);
    }
    return cliFailureExitCode;
  }
}

if (isCliEntrypoint(['inspect-components.js', 'emulsify-inspect-components'])) {
  process.exitCode = runCli();
}
