#!/usr/bin/env node

/**
 * @file Report legacy Twig Storybook stories that should migrate to renderTwig().
 */

import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { globSync } from 'glob';
import { resolveProjectConfig } from '../config/vite/project-config.js';

const STORY_GLOB = '**/*.stories.{js,jsx,ts,tsx}';
const IDENTIFIER_PATTERN = '[A-Za-z_$][\\w$]*';
const DEFAULT_IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.out/**',
  '**/.coverage/**',
];

/**
 * Escape a string for use inside a regular expression.
 *
 * @param {string} value - Raw string.
 * @returns {string} Escaped string.
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert a filesystem path to POSIX separators for readable output.
 *
 * @param {string} filePath - Filesystem path.
 * @returns {string} POSIX path.
 */
function toPosixPath(filePath) {
  return filePath.split(sep).join('/');
}

/**
 * Find the 1-based line number for a character index.
 *
 * @param {string} source - File source.
 * @param {number} index - Character index.
 * @returns {number} 1-based line number.
 */
function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

/**
 * Find imported Twig template identifiers.
 *
 * @param {string} source - Story source.
 * @returns {{name: string, specifier: string, line: number}[]} Twig imports.
 */
export function findTwigImports(source) {
  const imports = [];
  const patterns = [
    new RegExp(
      `import\\s+(${IDENTIFIER_PATTERN})\\s+from\\s+['"]([^'"]+\\.twig(?:\\?[^'"]*)?)['"]`,
      'g',
    ),
    new RegExp(
      `(?:const|let|var)\\s+(${IDENTIFIER_PATTERN})\\s*=\\s*require\\(\\s*['"]([^'"]+\\.twig(?:\\?[^'"]*)?)['"]\\s*\\)`,
      'g',
    ),
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      imports.push({
        name: match[1],
        specifier: match[2],
        line: lineNumberAt(source, match.index || 0),
      });
    }
  }

  return imports;
}

/**
 * Determine whether a story imports renderTwig from Emulsify Core.
 *
 * @param {string} source - Story source.
 * @returns {boolean} TRUE when renderTwig is imported from the public helper.
 */
export function importsRenderTwig(source) {
  return (
    /\brenderTwig\b/.test(source) &&
    /from\s+['"]@emulsify\/core\/storybook['"]/.test(source)
  );
}

/**
 * Find likely direct returns of imported Twig template functions.
 *
 * @param {string} source - Story source.
 * @param {string[]} templateNames - Imported Twig template identifiers.
 * @returns {{name: string, line: number}[]} Direct template calls.
 */
export function findDirectTemplateReturns(source, templateNames = []) {
  const calls = [];

  for (const templateName of templateNames) {
    const pattern = new RegExp(
      `(?:return\\s+|=>\\s*(?:\\(\\s*)?)${escapeRegExp(templateName)}\\s*\\(`,
      'g',
    );

    for (const match of source.matchAll(pattern)) {
      calls.push({
        name: templateName,
        line: lineNumberAt(source, match.index || 0),
      });
    }
  }

  return calls;
}

/**
 * Analyze one Storybook story source string.
 *
 * @param {string} source - Story source.
 * @param {string} [filePath=''] - Story file path.
 * @returns {object} Story analysis.
 */
export function analyzeStorySource(source, filePath = '') {
  const twigImports = findTwigImports(source);
  const templateNames = twigImports.map((item) => item.name);
  const hasRenderTwig = importsRenderTwig(source);
  const directTemplateReturns = findDirectTemplateReturns(
    source,
    templateNames,
  );
  const reasons = [];

  if (!twigImports.length) {
    return {
      filePath,
      twigImports,
      hasRenderTwig,
      directTemplateReturns,
      reasons,
      shouldUpgrade: false,
    };
  }

  if (!hasRenderTwig) {
    reasons.push('imports Twig templates without renderTwig()');
  }

  if (directTemplateReturns.length) {
    reasons.push('appears to return Twig HTML strings directly');
  }

  return {
    filePath,
    twigImports,
    hasRenderTwig,
    directTemplateReturns,
    reasons,
    shouldUpgrade: reasons.length > 0,
  };
}

/**
 * Resolve Storybook source roots for the project.
 *
 * @param {string} projectDir - Absolute project root.
 * @returns {string[]} Absolute story roots.
 */
export function resolveStoryRoots(projectDir) {
  try {
    const env = resolveProjectConfig(projectDir, process.env);
    const storyRoots = env.projectStructure?.storyRoots;
    if (Array.isArray(storyRoots) && storyRoots.length) {
      return storyRoots;
    }
  } catch {
    // Fall back to conventional roots when project config is absent or invalid.
  }

  return [resolve(projectDir, 'src'), resolve(projectDir, 'components')];
}

/**
 * Collect Storybook story files from normalized project roots.
 *
 * @param {string} projectDir - Absolute project root.
 * @returns {string[]} Absolute story file paths.
 */
export function collectStoryFiles(projectDir) {
  const files = new Set();

  for (const root of resolveStoryRoots(projectDir)) {
    if (!existsSync(root)) continue;

    for (const match of globSync(STORY_GLOB, {
      cwd: root,
      nodir: true,
      absolute: true,
      ignore: DEFAULT_IGNORES,
    })) {
      files.add(resolve(match));
    }
  }

  return Array.from(files).sort();
}

/**
 * Analyze all discovered story files in a project.
 *
 * @param {{projectDir?: string}} [options={}] - Audit options.
 * @returns {{projectDir: string, files: string[], findings: object[]}} Results.
 */
export function auditTwigStories(options = {}) {
  const projectDir = resolve(options.projectDir || process.cwd());
  const files = collectStoryFiles(projectDir);
  const findings = files
    .map((filePath) => {
      const source = readFileSync(filePath, 'utf8');
      return analyzeStorySource(source, filePath);
    })
    .filter((result) => result.shouldUpgrade);

  return {
    projectDir,
    files,
    findings,
  };
}

/**
 * Format audit findings for terminal output.
 *
 * @param {{projectDir: string, files: string[], findings: object[]}} result
 * Audit result.
 * @returns {string} Human-readable report.
 */
export function formatAuditReport(result) {
  const lines = [
    'Twig story migration audit',
    `Scanned ${result.files.length} story file(s).`,
  ];

  if (!result.findings.length) {
    lines.push('No legacy Twig story candidates found.');
    return lines.join('\n');
  }

  lines.push(
    `Found ${result.findings.length} story file(s) that should be reviewed:`,
  );

  for (const finding of result.findings) {
    const relPath = toPosixPath(relative(result.projectDir, finding.filePath));
    const importNames = finding.twigImports.map((item) => item.name).join(', ');

    lines.push('', `- ${relPath}`);
    lines.push(`  Twig imports: ${importNames}`);
    for (const reason of finding.reasons) {
      lines.push(`  Reason: ${reason}.`);
    }
    for (const call of finding.directTemplateReturns) {
      lines.push(
        `  Line ${call.line}: ${call.name}() appears to be returned directly.`,
      );
    }
  }

  lines.push(
    '',
    'Suggested migration: import { renderTwig } from "@emulsify/core/storybook" and move any argument mapping into renderTwig(template, { context }).',
  );

  return lines.join('\n');
}

/**
 * Parse command-line arguments.
 *
 * @param {string[]} argv - CLI arguments.
 * @returns {{projectDir: string, failOnFound: boolean, json: boolean, help: boolean}}
 * Parsed options.
 */
function parseArgs(argv) {
  const options = {
    projectDir: process.cwd(),
    failOnFound: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--fail-on-found') {
      options.failOnFound = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--root') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--root requires a project directory.');
      }
      options.projectDir = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--root=')) {
      options.projectDir = arg.slice('--root='.length);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

/**
 * CLI usage text.
 *
 * @returns {string} Usage text.
 */
function usage() {
  return [
    'Usage: emulsify-audit-twig-stories [--root <dir>] [--json] [--fail-on-found]',
    '',
    'Options:',
    '  --root <dir>      Project root to scan. Defaults to the current directory.',
    '  --json            Print machine-readable JSON.',
    '  --fail-on-found   Exit with code 1 when migration candidates are found.',
    '  --help            Print this help text.',
  ].join('\n');
}

/**
 * Run the CLI.
 *
 * @param {string[]} argv - CLI arguments.
 * @returns {number} Process exit code.
 */
export function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(usage());
    return 0;
  }

  const result = auditTwigStories({
    projectDir: options.projectDir,
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatAuditReport(result));
  }

  return options.failOnFound && result.findings.length ? 1 : 0;
}

if (process.argv[1]?.split(/[\\/]/).pop() === 'audit-twig-stories.js') {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error.message || error);
    console.error('');
    console.error(usage());
    process.exitCode = 1;
  }
}
