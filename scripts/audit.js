#!/usr/bin/env node

/**
 * @file Combined Emulsify project readiness audit.
 */

import { lstatSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { globSync } from 'glob';
import { resolveProjectConfig } from '../config/vite/project-config.js';
import {
  compiledAssetOutputPath,
  storybookStyleOutputPath,
} from '../config/vite/project-structure.js';
import {
  firstExistingPath,
  safeExists,
  safeReadFile,
  safeReadJson,
} from '../config/vite/utils/fs-safe.js';
import { toPosixPath } from '../config/vite/utils/paths.js';
import { candidateKeysForReference } from '../src/storybook/twig/reference-paths.js';
import { analyzeStorySource, collectStoryFiles } from './audit-twig-stories.js';

const STORY_GLOB = '**/*.stories.{js,jsx,ts,tsx}';
const CODE_GLOB = '**/*.{js,jsx,ts,tsx,mjs,cjs}';
const TWIG_GLOB = '**/*.twig';
const STYLE_GLOB = '**/*.{css,scss,sass}';
const DEFAULT_IGNORES = [
  '**/.coverage/**',
  '**/.git/**',
  '**/.github/**',
  '**/.out/**',
  '**/dist/**',
  '**/*.min.css',
  '**/*.test.{js,jsx,ts,tsx,mjs,cjs}',
  '**/node_modules/**',
  '**/scripts/audit.js',
  '**/vendor/**',
];
const PUBLIC_CORE_IMPORTS = new Set([
  '@emulsify/core',
  '@emulsify/core/extensions',
  '@emulsify/core/extensions/react',
  '@emulsify/core/extensions/twig',
  '@emulsify/core/package.json',
  '@emulsify/core/storybook',
  '@emulsify/core/vite',
  '@emulsify/core/vite/plugins',
]);
const DEFAULT_TWIG_THRESHOLD = 250;
const RECOMMENDED_PACKAGE_OVERRIDES = [
  {
    label: 'glob',
    value: '^13.0.6',
    paths: [['glob']],
  },
  {
    label: 'locutus',
    value: '^3.0.36',
    paths: [['locutus']],
  },
  {
    label: 'minimatch@3.0.x',
    value: '^3.1.5',
    paths: [['minimatch@3.0.x']],
  },
];
const GENERATED_PACKAGE_SCRIPT_DOCS =
  'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/migration-4x.md#manual-packagejson-updates';

/**
 * Cache source file reads for one top-level audit run.
 *
 * @type {Map<string, string|null>}
 */
const fileReadCache = new Map();

/**
 * Clear the per-run source file read cache.
 *
 * @returns {void}
 */
function resetFileReadCache() {
  fileReadCache.clear();
}

/**
 * Read a text source file once per top-level audit run.
 *
 * Missing files are cached as null internally but still return an empty string
 * to preserve safeReadFile() behavior for existing checks.
 *
 * @param {string} filePath - Absolute or relative file path.
 * @returns {string} File contents, or an empty string when unavailable.
 */
function cachedReadFile(filePath) {
  const absPath = resolve(filePath);
  if (fileReadCache.has(absPath)) {
    return fileReadCache.get(absPath) ?? '';
  }

  const source = safeReadFile(absPath);
  const cachedSource = source === '' && !safeExists(absPath) ? null : source;
  fileReadCache.set(absPath, cachedSource);

  return cachedSource ?? '';
}

/**
 * Return a project-relative path for report output.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string} filePath - Absolute file path.
 * @returns {string} Project-relative POSIX path.
 */
function displayPath(projectDir, filePath) {
  return toPosixPath(relative(projectDir, filePath));
}

/**
 * Determine whether a candidate is a directory.
 *
 * @param {string} filePath - Absolute path.
 * @returns {boolean} TRUE when the path is a directory.
 */
function safeIsDirectory(filePath) {
  try {
    return lstatSync(filePath).isDirectory();
  } catch {
    return false;
  }
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
 * Build a report finding.
 *
 * @param {object} finding - Finding details.
 * @returns {object} Normalized finding.
 */
function makeFinding(finding) {
  return {
    severity: 'warn',
    docs: undefined,
    ...finding,
  };
}

/**
 * Collect files from a project.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string|string[]} patterns - Glob pattern or patterns.
 * @returns {string[]} Absolute file paths.
 */
export function collectProjectFiles(projectDir, patterns) {
  return globSync(patterns, {
    cwd: projectDir,
    nodir: true,
    absolute: true,
    ignore: DEFAULT_IGNORES,
  })
    .map((filePath) => resolve(filePath))
    .sort();
}

/**
 * Return a normalized, project-contained root list.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string[]} roots - Absolute candidate roots.
 * @returns {string[]} Existing roots inside the project.
 */
function normalizeAuditRoots(projectDir, roots = []) {
  const resolvedProject = resolve(projectDir);

  return Array.from(
    new Set(
      roots
        .filter(Boolean)
        .map((root) => resolve(root))
        .filter(
          (root) =>
            isSameOrInside(root, resolvedProject) && safeIsDirectory(root),
        ),
    ),
  ).sort();
}

/**
 * Collect files from normalized audit roots only.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string|string[]} patterns - Glob pattern or patterns.
 * @param {string[]} roots - Absolute roots to scan.
 * @returns {string[]} Absolute file paths.
 */
function collectRootedProjectFiles(projectDir, patterns, roots = []) {
  const files = new Set();

  for (const root of normalizeAuditRoots(projectDir, roots)) {
    for (const filePath of globSync(patterns, {
      cwd: root,
      nodir: true,
      absolute: true,
      ignore: DEFAULT_IGNORES,
    })) {
      files.add(resolve(filePath));
    }
  }

  return Array.from(files).sort();
}

/**
 * Determine whether a file is inside one of the roots.
 *
 * @param {string} filePath - Absolute file path.
 * @param {string[]} roots - Absolute roots.
 * @returns {boolean} TRUE when inside a root.
 */
function isInsideAnyRoot(filePath, roots = []) {
  return roots.some((root) => {
    const rel = relative(root, filePath);
    return Boolean(rel) && !rel.startsWith('..') && !rel.includes(`..${sep}`);
  });
}

/**
 * Determine whether a path is the same as, or inside, a root directory.
 *
 * @param {string} filePath - Absolute file path.
 * @param {string} root - Absolute root path.
 * @returns {boolean} TRUE when the path is inside or equal to the root.
 */
function isSameOrInside(filePath, root) {
  const rel = relative(root, filePath);
  return !rel || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}

/**
 * Return a nested object value.
 *
 * @param {object} obj - Object to inspect.
 * @param {string[]} pathParts - Nested object path.
 * @returns {*} Nested value.
 */
function valueAtPath(obj, pathParts) {
  return pathParts.reduce(
    (current, key) =>
      current && typeof current === 'object' ? current[key] : undefined,
    obj,
  );
}

/**
 * Determine whether a package manifest depends on Emulsify Core.
 *
 * @param {object} packageJson - Parsed package.json.
 * @returns {boolean} TRUE when package.json is Core or consumes Core.
 */
function packageUsesEmulsifyCore(packageJson = {}) {
  if (packageJson.name === '@emulsify/core') {
    return true;
  }

  return [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ].some((section) =>
    Object.prototype.hasOwnProperty.call(
      packageJson[section] || {},
      '@emulsify/core',
    ),
  );
}

/**
 * Determine whether a package manifest is Emulsify Core itself.
 *
 * @param {object} packageJson - Parsed package.json.
 * @returns {boolean} TRUE when package.json is Core.
 */
function packageIsEmulsifyCore(packageJson = {}) {
  return packageJson.name === '@emulsify/core';
}

/**
 * Determine whether a recommended override is already present.
 *
 * @param {object} overrides - package.json overrides object.
 * @param {{paths: string[][]}} recommendation - Override recommendation.
 * @returns {boolean} TRUE when any equivalent override path exists.
 */
function hasRecommendedOverride(overrides = {}, recommendation) {
  return recommendation.paths.some(
    (pathParts) => valueAtPath(overrides, pathParts) !== undefined,
  );
}

/**
 * Normalize the project config, retaining any resolution failure.
 *
 * @param {string} projectDir - Absolute project root.
 * @returns {{env: object, configExists: boolean, error?: Error}}
 */
function resolveAuditEnvironment(projectDir) {
  const configExists = safeExists(resolve(projectDir, 'project.emulsify.json'));

  try {
    return {
      env: resolveProjectConfig(projectDir, process.env),
      configExists,
    };
  } catch (error) {
    return {
      env: {
        projectDir,
        platform: 'generic',
        namespaceRoots: {},
        projectStructure: {},
      },
      configExists,
      error,
    };
  }
}

/**
 * Audit basic project configuration and structure root health.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
function auditProjectConfig(context) {
  const { configExists, env, error, projectDir } = context;
  const findings = [];

  if (!configExists) {
    findings.push(
      makeFinding({
        id: 'missing-project-config',
        severity: 'error',
        message:
          'project.emulsify.json is missing, so platform and structure defaults may not match the project.',
        docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/project-structure.md',
      }),
    );
  }

  if (error) {
    findings.push(
      makeFinding({
        id: 'project-config-resolution-failed',
        severity: 'error',
        message: `Unable to resolve project.emulsify.json: ${error.message || error}`,
      }),
    );
  }

  for (const implementation of env.structureImplementations || []) {
    if (!safeIsDirectory(implementation.directory)) {
      findings.push(
        makeFinding({
          id: 'missing-structure-implementation',
          severity: 'error',
          filePath: resolve(projectDir, 'project.emulsify.json'),
          message: `Configured structureImplementation "${implementation.name}" does not exist: ${displayPath(
            projectDir,
            implementation.directory,
          )}`,
          docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/project-structure.md',
        }),
      );
    }
  }

  return findings;
}

/**
 * Audit package-level dependency override policy for installed projects.
 *
 * npm only applies `overrides` from the root package being installed. When
 * Emulsify Core is installed into a generated theme, Core's own overrides do
 * not protect that theme's transitive dependency graph.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
function auditPackageOverrides(context) {
  const { projectDir } = context;
  const packagePath = resolve(projectDir, 'package.json');

  if (!safeExists(packagePath)) {
    return [];
  }

  const { data: packageJson, error } = safeReadJson(packagePath);
  if (error) {
    return [
      makeFinding({
        id: 'package-json-unreadable',
        severity: 'warn',
        filePath: packagePath,
        message: `Unable to parse package.json: ${error.message || error}`,
      }),
    ];
  }

  if (!packageUsesEmulsifyCore(packageJson)) {
    return [];
  }

  const overrides = packageJson.overrides || {};
  const missing = RECOMMENDED_PACKAGE_OVERRIDES.filter(
    (recommendation) => !hasRecommendedOverride(overrides, recommendation),
  );

  if (!missing.length) {
    return [];
  }

  return [
    makeFinding({
      id: 'recommended-package-overrides-missing',
      severity: 'warn',
      filePath: packagePath,
      message:
        'package.json is missing recommended root npm overrides for Emulsify Core transitive install warnings.',
      details: missing.map(
        (recommendation) =>
          `Add overrides.${recommendation.label}: ${recommendation.value}.`,
      ),
      docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/migration-4x.md#install-warning-controls',
    }),
  ];
}

/**
 * Audit generated-theme package scripts that must be updated manually.
 *
 * Generated themes copy their root package.json from the starter at creation
 * time. Whisk updates do not automatically flow into existing themes, so the
 * audit flags stale Webpack-era scripts and missing Core 4 audit/Vite scripts.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
function auditGeneratedPackageScripts(context) {
  const { env, projectDir } = context;
  const packagePath = resolve(projectDir, 'package.json');

  if (!safeExists(packagePath)) {
    return [];
  }

  const { data: packageJson, error } = safeReadJson(packagePath);
  if (error || !packageUsesEmulsifyCore(packageJson)) {
    return [];
  }

  if (packageIsEmulsifyCore(packageJson)) {
    return [];
  }

  const scripts = packageJson.scripts || {};
  const starterRepository = env.projectConfig?.starter?.repository;
  const fromGeneratedStarter =
    typeof starterRepository === 'string' &&
    /emulsify-(drupal|wordpress|craftcms|starter)|emulsify-ds/i.test(
      starterRepository,
    );
  const usesGeneratedCoreScripts = Object.values(scripts).some(
    (script) =>
      typeof script === 'string' &&
      /node_modules\/@emulsify\/core\/(?:config\/(?:webpack|vite)|scripts\/audit)/.test(
        script,
      ),
  );

  if (!fromGeneratedStarter && !usesGeneratedCoreScripts) {
    return [];
  }

  const findings = [];
  const details = [];
  const buildScript = scripts.build || '';

  if (/\bwebpack\b|config\/webpack/.test(buildScript)) {
    details.push('Replace scripts.build with the Vite build command.');
  } else if (
    /node_modules\/@emulsify\/core\/config\/vite\/vite\.config\.js/.test(
      buildScript,
    ) &&
    /\bvite\s+(?:--config|-c)\b/.test(buildScript)
  ) {
    details.push('Replace scripts.build with the Vite build command.');
  }

  if (Object.prototype.hasOwnProperty.call(scripts, 'build-dev')) {
    details.push('Remove scripts.build-dev; the Vite build replaces it.');
  }

  if (/\bwebpack\b|npm:webpack|config\/webpack/.test(scripts.develop || '')) {
    details.push('Replace scripts.develop with the Vite/Storybook watcher.');
  }

  if (Object.prototype.hasOwnProperty.call(scripts, 'webpack')) {
    details.push('Replace scripts.webpack with scripts.vite.');
  }

  for (const scriptName of ['audit', 'audit:twig-stories', 'vite']) {
    if (!Object.prototype.hasOwnProperty.call(scripts, scriptName)) {
      details.push(`Add scripts.${scriptName}.`);
    }
  }

  if (details.length) {
    findings.push(
      makeFinding({
        id: 'generated-package-json-migration-needed',
        severity: 'warn',
        filePath: packagePath,
        message:
          'package.json does not match the generated-theme scripts expected by Emulsify Core 4.',
        details,
        docs: GENERATED_PACKAGE_SCRIPT_DOCS,
      }),
    );
  }

  return findings;
}

/**
 * Audit story files that will not be discovered by Storybook.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
function auditStoryDiscovery(context) {
  const { projectDir, storyFiles } = context;
  const discovered = new Set(collectStoryFiles(projectDir));
  const findings = [];

  for (const storyFile of storyFiles) {
    if (discovered.has(storyFile)) continue;

    findings.push(
      makeFinding({
        id: 'story-outside-discovered-roots',
        severity: 'error',
        filePath: storyFile,
        message:
          'Story file is outside the normalized Storybook roots and will not be discovered.',
        docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/project-structure.md',
      }),
    );
  }

  return findings;
}

/**
 * Add legacy Twig story migration findings.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
function auditLegacyTwigStories(context) {
  const { storyFiles } = context;
  const findings = storyFiles
    .map((filePath) => analyzeStorySource(cachedReadFile(filePath), filePath))
    .filter((result) => result.shouldUpgrade);

  return findings.map((finding) =>
    makeFinding({
      id: 'legacy-twig-story',
      severity: 'warn',
      filePath: finding.filePath,
      line: finding.directTemplateReturns[0]?.line,
      message:
        'Twig story appears to return an HTML string directly. This remains compatible, but renderTwig() is preferred for active migrations.',
      details: finding.reasons,
      docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/storybook.md#legacy-twig-story-compatibility',
    }),
  );
}

/**
 * Extract string arguments passed to include() or source().
 *
 * @param {string} source - Twig source.
 * @returns {{type: string, value: string, line: number}[]} References.
 */
export function findTwigIncludeSourceReferences(source) {
  const references = [];
  const callPattern = /\b(include|source)\s*\(([\s\S]*?)\)/g;

  for (const callMatch of source.matchAll(callPattern)) {
    const type = callMatch[1];
    const args = firstArgumentText(callMatch[2]);
    const argsOffset = (callMatch.index || 0) + callMatch[0].indexOf(args);
    const stringPattern = /['"]([^'"]+)['"]/g;

    for (const stringMatch of args.matchAll(stringPattern)) {
      references.push({
        type,
        value: stringMatch[1],
        line: lineNumberAt(source, argsOffset + (stringMatch.index || 0)),
      });
    }
  }

  return references;
}

/**
 * Extract the first function argument, including array syntax.
 *
 * Twig include()/source() only use the first argument as the template/source
 * reference. Later object values may also be strings, but they are context
 * values and should not be treated as template references.
 *
 * @param {string} args - Function argument source.
 * @returns {string} First argument source.
 */
function firstArgumentText(args) {
  let quote = '';
  let depth = 0;

  for (let index = 0; index < args.length; index += 1) {
    const char = args[index];
    const prev = args[index - 1];

    if (quote) {
      if (char === quote && prev !== '\\') {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char.charCodeAt(0) === 39) {
      quote = char;
      continue;
    }
    if (char === '[' || char === '{' || char === '(') {
      depth += 1;
      continue;
    }
    if (char === ']' || char === '}' || char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === ',' && depth === 0) {
      return args.slice(0, index);
    }
  }

  return args;
}

/**
 * Extract Twig namespace references such as @components/card/card.twig.
 *
 * @param {string} source - Twig source.
 * @returns {{namespace: string, value: string, line: number}[]} Namespace refs.
 */
export function findTwigNamespaceReferences(source) {
  const references = [];
  const pattern = /@([A-Za-z][\w-]*)\/[A-Za-z0-9_./-]+/g;

  for (const match of source.matchAll(pattern)) {
    references.push({
      namespace: match[1],
      value: match[0],
      line: lineNumberAt(source, match.index || 0),
    });
  }

  return references;
}

/**
 * Build candidate paths for a relative Twig reference.
 *
 * @param {string} filePath - Referencing file.
 * @param {string} reference - Twig reference.
 * @returns {string[]} Absolute candidate paths.
 */
function relativeTwigCandidates(filePath, reference) {
  const base = resolve(dirname(filePath), reference);
  if (/\.[A-Za-z0-9]+$/.test(reference)) {
    return [base];
  }

  return [`${base}.twig`, `${base}.html.twig`];
}

/**
 * Convert resolver candidate keys into absolute filesystem paths.
 *
 * @param {string[]} keys - Root-relative Vite keys.
 * @param {object} env - Normalized environment.
 * @returns {string[]} Absolute candidate paths.
 */
function candidateKeysToFiles(keys, env) {
  const projectDir = env.projectDir || process.cwd();

  return keys.map((key) =>
    key.startsWith('/') ? resolve(projectDir, key.slice(1)) : resolve(key),
  );
}

/**
 * Determine whether a Twig include/source reference resolves.
 *
 * @param {string} reference - Twig reference.
 * @param {string} filePath - Referencing file path.
 * @param {object} env - Normalized environment.
 * @returns {boolean} TRUE when a candidate exists.
 */
export function resolvesTwigReference(reference, filePath, env) {
  if (!reference || /^https?:\/\//i.test(reference)) return true;

  if (reference.startsWith('@assets/')) {
    const relAsset = reference.replace(/^@assets\//, '');
    return safeExists(resolve(env.projectDir, 'assets', relAsset));
  }

  const candidates =
    reference.startsWith('./') || reference.startsWith('../')
      ? relativeTwigCandidates(filePath, reference)
      : candidateKeysToFiles(candidateKeysForReference(reference, env), env);

  return candidates.some(safeExists);
}

/**
 * Audit Twig namespace and include/source resolution.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
function auditTwigReferences(context) {
  const { env, projectDir, twigFiles } = context;
  const namespaceRoots = env.namespaceRoots || {};
  const knownNamespaces = new Set([...Object.keys(namespaceRoots), 'assets']);
  const findings = [];
  const seen = new Set();

  for (const twigFile of twigFiles) {
    const source = cachedReadFile(twigFile);

    for (const ref of findTwigNamespaceReferences(source)) {
      if (knownNamespaces.has(ref.namespace)) continue;

      const key = `${twigFile}:${ref.line}:unknown:${ref.namespace}`;
      if (seen.has(key)) continue;
      seen.add(key);

      findings.push(
        makeFinding({
          id: 'unknown-twig-namespace',
          severity: 'warn',
          filePath: twigFile,
          line: ref.line,
          message: `Twig namespace "@${ref.namespace}" is not configured in the normalized project structure.`,
          docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/project-structure.md#twig-namespaces',
        }),
      );
    }

    for (const ref of findTwigIncludeSourceReferences(source)) {
      if (!resolvesTwigReference(ref.value, twigFile, env)) {
        findings.push(
          makeFinding({
            id: 'unresolved-twig-reference',
            severity: 'warn',
            filePath: twigFile,
            line: ref.line,
            message: `${ref.type}() reference "${ref.value}" could not be resolved from the normalized Twig roots.`,
            docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/storybook.md#include',
          }),
        );
      }
    }
  }

  return findings.map((finding) => ({
    ...finding,
    filePath: finding.filePath || resolve(projectDir, 'project.emulsify.json'),
  }));
}

/**
 * Extract simple same-file Sass string variables.
 *
 * @param {string} source - Stylesheet source.
 * @returns {Map<string, string>} Variable value map.
 */
function findSassStringVariables(source) {
  const variables = new Map();
  const pattern = /^\s*\$([\w-]+)\s*:\s*(['"])(.*?)\2\s*;?/gm;

  for (const match of source.matchAll(pattern)) {
    variables.set(match[1], match[3]);
  }

  return variables;
}

/**
 * Resolve same-file Sass variable interpolation in a URL value.
 *
 * This intentionally handles only simple string variables. It is enough to make
 * common asset roots such as `#{$font-url}/Avenir.woff2` auditable without
 * pretending to be a Sass compiler.
 *
 * @param {string} value - Raw URL value.
 * @param {Map<string, string>} variables - Sass variable map.
 * @returns {string} URL value with known interpolations expanded.
 */
function resolveSassUrlValue(value, variables) {
  return value.replace(/#\{\$([\w-]+)\}/g, (match, name) =>
    variables.has(name) ? variables.get(name) : match,
  );
}

/**
 * Mask style comments while preserving line and character positions.
 *
 * @param {string} source - Stylesheet source.
 * @returns {string} Source with comments replaced by whitespace.
 */
function maskStyleComments(source) {
  const blank = (match) => match.replace(/[^\n]/g, ' ');

  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[\t ]*\/\/.*$/gm, blank);
}

/**
 * Extract URL references from CSS or Sass source.
 *
 * @param {string} source - Stylesheet source.
 * @returns {{value: string, raw: string, line: number}[]} URL references.
 */
export function findCssUrlReferences(source) {
  const scanSource = maskStyleComments(source);
  const variables = findSassStringVariables(scanSource);
  const references = [];
  const pattern = /url\(\s*(?:(['"])(.*?)\1|([^'")][^)]*?))\s*\)/g;

  for (const match of scanSource.matchAll(pattern)) {
    const raw = (match[2] ?? match[3] ?? '').trim();
    const value = resolveSassUrlValue(raw, variables).trim();

    references.push({
      value,
      raw,
      line: lineNumberAt(source, match.index || 0),
    });
  }

  return references;
}

/**
 * Determine whether a CSS URL should be skipped by filesystem checks.
 *
 * @param {string} value - URL value.
 * @returns {boolean} TRUE when the URL is not a local relative asset path.
 */
function isNonFilesystemCssUrl(value) {
  return (
    !value ||
    value.startsWith('#') ||
    value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('$') ||
    value.startsWith('#{') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    /^var\(/i.test(value) ||
    /^env\(/i.test(value)
  );
}

/**
 * Remove query string and hash suffixes from a URL path.
 *
 * @param {string} value - URL value.
 * @returns {string} Path portion.
 */
function cssUrlPath(value) {
  return value.split(/[?#]/)[0];
}

/**
 * Resolve an emitted CSS output key to the actual CSS file path.
 *
 * Vite entry keys use `__style` internally to avoid JS/CSS collisions. The
 * shared Vite config removes that suffix from emitted CSS file names.
 *
 * @param {string} key - Output key without extension.
 * @returns {string} Emitted CSS file path relative to output root.
 */
function emittedCssRelativePath(key) {
  return `${key.replace(/__style$/i, '')}.css`;
}

/**
 * Return possible runtime directories for a style file's emitted CSS.
 *
 * @param {string} filePath - Source stylesheet.
 * @param {object} env - Normalized environment.
 * @param {string} projectDir - Project root.
 * @returns {string[]} Absolute runtime directories.
 */
function styleRuntimeDirectories(filePath, env, projectDir) {
  if (!/\.(scss|sass|css)$/i.test(filePath)) return [];
  if (basename(filePath).startsWith('_')) return [];

  const structure = env.projectStructure || {};
  if (!structure.output) return [];

  const ctx = {
    projectDir,
    srcDir: env.srcDir || resolve(projectDir, 'src'),
    SDC: Boolean(env.SDC),
  };
  const fileName = basename(filePath);
  const isStorybookStyle = /^(cl-|sb-)/.test(fileName);
  const key = isStorybookStyle
    ? storybookStyleOutputPath(filePath, structure, ctx)
    : compiledAssetOutputPath(filePath, 'css', structure, ctx);

  if (!key) return [];

  const relCss = emittedCssRelativePath(key);
  const directories = [dirname(resolve(projectDir, 'dist', relCss))];

  if (structure.mirrorComponentOutput && relCss.startsWith('components/')) {
    directories.push(dirname(resolve(projectDir, relCss)));
  }

  return Array.from(new Set(directories));
}

/**
 * Audit local CSS/Sass asset URLs that Vite may leave to runtime resolution.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
function auditCssAssetReferences(context) {
  const { env, projectDir, styleFiles } = context;
  const findings = [];
  const projectAssetsDir = resolve(projectDir, 'assets');
  const styleSourceRoots = env.projectStructure?.sourceRoots || [];

  for (const filePath of styleFiles) {
    if (
      styleSourceRoots.length &&
      !isInsideAnyRoot(filePath, styleSourceRoots)
    ) {
      continue;
    }

    const source = cachedReadFile(filePath);
    const runtimeDirs = styleRuntimeDirectories(filePath, env, projectDir);

    for (const ref of findCssUrlReferences(source)) {
      if (isNonFilesystemCssUrl(ref.value)) continue;

      const assetPath = cssUrlPath(ref.value);
      if (!assetPath) continue;

      const sourceAsset = firstExistingPath([
        resolve(dirname(filePath), assetPath),
      ]);
      const runtimeAsset = firstExistingPath(
        runtimeDirs.map((directory) => resolve(directory, assetPath)),
      );
      const resolvedAsset = sourceAsset || runtimeAsset;

      if (!resolvedAsset) {
        findings.push(
          makeFinding({
            id: 'unresolved-css-asset-reference',
            severity: 'warn',
            filePath,
            line: ref.line,
            message: `CSS asset URL "${ref.raw}" could not be resolved from the source file or expected emitted CSS location.`,
            details: [
              'Check for a typo, move the asset into a source-root-relative location Vite can resolve, or rewrite the URL to a stable Drupal/theme public path.',
            ],
            docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/migration-4x.md#css-asset-urls',
          }),
        );
        continue;
      }

      if (
        isSameOrInside(resolvedAsset, projectAssetsDir) &&
        (!sourceAsset || runtimeAsset || assetPath.startsWith('..'))
      ) {
        findings.push(
          makeFinding({
            id: 'css-runtime-asset-reference',
            severity: 'info',
            filePath,
            line: ref.line,
            message: `CSS asset URL "${ref.raw}" resolves to project-level assets and may be left unchanged by Vite for runtime resolution.`,
            details: [
              `Resolved asset: ${displayPath(projectDir, resolvedAsset)}.`,
              'This is acceptable when Drupal serves the asset at that runtime URL. To make Vite bundle or rebase it, move the asset under a source root and reference it from the authored stylesheet.',
            ],
            docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/migration-4x.md#css-asset-urls',
          }),
        );
      }
    }
  }

  return findings;
}

/**
 * Audit Webpack-era files and code patterns.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
function auditWebpackPatterns(context) {
  const { codeFiles, projectDir } = context;
  const findings = [];
  const webpackConfig = resolve(projectDir, '.storybook/webpack.config.js');
  const webpackDir = resolve(projectDir, 'config/webpack');

  if (safeExists(webpackConfig)) {
    findings.push(
      makeFinding({
        id: 'webpack-config-file',
        severity: 'warn',
        filePath: webpackConfig,
        message:
          'Webpack-specific Storybook config is present and should be migrated to Vite/Storybook overrides.',
        docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/migration-4x.md#vite-customization',
      }),
    );
  }

  if (safeIsDirectory(webpackDir)) {
    findings.push(
      makeFinding({
        id: 'webpack-config-directory',
        severity: 'warn',
        filePath: webpackDir,
        message:
          'config/webpack exists. Webpack-specific customization should move to Vite plugins or extendConfig().',
        docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/extension-points.md#vite-plugins-and-config-patches',
      }),
    );
  }

  const patterns = [
    {
      regex: /\brequire\.context\s*\(/,
      message: 'require.context() is Webpack-specific and should be migrated.',
    },
    {
      regex:
        /\b(raw-loader|twig-loader|style-loader|file-loader|sass-loader)\b/,
      message: 'Webpack loader references should be migrated to Vite plugins.',
    },
    {
      regex: /from\s+['"][^'"]+![^'"]+['"]|import\s+['"][^'"]+![^'"]+['"]/,
      message: 'Inline Webpack loader import syntax should be removed.',
    },
  ];

  for (const filePath of codeFiles) {
    const source = cachedReadFile(filePath);

    for (const pattern of patterns) {
      const match = pattern.regex.exec(source);
      if (!match) continue;

      findings.push(
        makeFinding({
          id: 'webpack-era-pattern',
          severity: 'warn',
          filePath,
          line: lineNumberAt(source, match.index || 0),
          message: pattern.message,
          docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/migration-4x.md#vite-customization',
        }),
      );
    }
  }

  return findings;
}

/**
 * Extract import specifiers from JavaScript source.
 *
 * @param {string} source - JavaScript source.
 * @returns {{specifier: string, index: number}[]} Import specifiers.
 */
function findImportSpecifiers(source) {
  const imports = [];
  const patterns = [
    /(?:import|export)\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      imports.push({
        specifier: match[1],
        index: match.index || 0,
      });
    }
  }

  return imports;
}

/**
 * Audit direct imports of Emulsify Core internals.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
function auditCoreImports(context) {
  const { codeFiles } = context;
  const findings = [];

  for (const filePath of codeFiles) {
    const source = cachedReadFile(filePath);

    for (const item of findImportSpecifiers(source)) {
      const { specifier } = item;
      if (!specifier.startsWith('@emulsify/core/')) continue;
      if (PUBLIC_CORE_IMPORTS.has(specifier)) continue;

      findings.push(
        makeFinding({
          id: 'internal-core-import',
          severity: 'warn',
          filePath,
          line: lineNumberAt(source, item.index),
          message: `Import "${specifier}" uses an internal Emulsify Core path. Prefer a public package export.`,
          docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/README.md#public-imports',
        }),
      );
    }
  }

  return findings;
}

/**
 * Audit Drupal assumptions in non-Drupal projects.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
function auditDrupalAssumptions(context) {
  const { codeFiles, env } = context;
  if (env.platform === 'drupal') return [];

  const findings = [];
  const patterns = [
    /\bDrupal\.attachBehaviors\b/,
    /\bwindow\.Drupal\b/,
    /\bglobalThis\.Drupal\b/,
    /['"][^'"]*_drupal\.js['"]/,
    /['"]twig-drupal-filters['"]/,
  ];

  for (const filePath of codeFiles) {
    const source = cachedReadFile(filePath);
    const match = patterns.map((pattern) => pattern.exec(source)).find(Boolean);

    if (!match) continue;

    findings.push(
      makeFinding({
        id: 'drupal-assumption-non-drupal',
        severity: 'warn',
        filePath,
        line: lineNumberAt(source, match.index || 0),
        message:
          'Drupal-specific Storybook/runtime code was found, but the active platform is not drupal.',
        docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/platform-adapters.md',
      }),
    );
  }

  return findings;
}

/**
 * Audit files that look like component Twig files outside source roots.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
function auditFilesOutsideRoots(context) {
  const { env, projectDir, twigFiles } = context;
  const roots = [
    ...(env.projectStructure?.twigRoots || []),
    ...(env.projectStructure?.sourceRoots || []),
  ];

  if (!roots.length) return [];

  return twigFiles
    .filter((filePath) => !isInsideAnyRoot(filePath, roots))
    .map((filePath) =>
      makeFinding({
        id: 'twig-file-outside-source-roots',
        severity: 'info',
        filePath,
        message:
          'Twig file is outside normalized source roots and will not be available to Storybook include()/source() unless another integration loads it.',
        docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/project-structure.md',
      }),
    )
    .filter((finding) => !isNonComponentTwigFile(projectDir, finding.filePath));
}

/**
 * Determine whether a Twig file is intentionally outside component roots.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string} filePath - Absolute Twig file path.
 * @returns {boolean} TRUE when the file should not be treated as component source.
 */
function isNonComponentTwigFile(projectDir, filePath) {
  const relPath = displayPath(projectDir, filePath);

  return (
    relPath.startsWith('docs/') ||
    relPath.startsWith('templates/') ||
    relPath.includes('/templates/')
  );
}

/**
 * Recursively measure a directory size.
 *
 * @param {string} directory - Directory path.
 * @returns {number} Size in bytes.
 */
function directorySize(directory) {
  let total = 0;

  try {
    for (const entry of readdirSync(directory)) {
      const entryPath = resolve(directory, entry);
      const stats = statSync(entryPath);
      total += stats.isDirectory() ? directorySize(entryPath) : stats.size;
    }
  } catch {
    return total;
  }

  return total;
}

/**
 * Audit Twig volume under Storybook roots.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
function auditTwigVolume(context) {
  const { env, twigThreshold } = context;
  const roots = Array.from(new Set(env.projectStructure?.twigRoots || []));
  const twigFiles = new Set();

  for (const root of roots) {
    if (!safeIsDirectory(root)) continue;
    for (const filePath of globSync(TWIG_GLOB, {
      cwd: root,
      absolute: true,
      nodir: true,
      ignore: DEFAULT_IGNORES,
    })) {
      twigFiles.add(resolve(filePath));
    }
  }

  if (twigFiles.size <= twigThreshold) return [];

  const totalBytes = roots.reduce(
    (total, root) => total + directorySize(root),
    0,
  );

  return [
    makeFinding({
      id: 'large-twig-storybook-roots',
      severity: 'info',
      message: `${twigFiles.size} Twig files are under Storybook Twig roots. Eager Twig imports are reliable but can increase Storybook startup/build cost for large libraries.`,
      details: [
        `Approximate Twig root size: ${Math.round(totalBytes / 1024)} KB.`,
      ],
      docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/performance.md#storybook-twig-imports',
    }),
  ];
}

/**
 * Run the combined Emulsify audit.
 *
 * @param {{projectDir?: string, twigThreshold?: number}} [options={}] - Options.
 * @returns {{projectDir: string, summary: object, findings: object[]}} Audit result.
 */
export function auditProject(options = {}) {
  resetFileReadCache();

  const projectDir = resolve(options.projectDir || process.cwd());
  const envResult = resolveAuditEnvironment(projectDir);
  const structure = envResult.env.projectStructure || {};
  const sourceRoots = normalizeAuditRoots(
    projectDir,
    structure.sourceRoots || [],
  );
  const storyRoots = normalizeAuditRoots(
    projectDir,
    structure.storyRoots || sourceRoots,
  );
  const twigRoots = normalizeAuditRoots(
    projectDir,
    structure.twigRoots || sourceRoots,
  );
  const storyFiles = collectRootedProjectFiles(
    projectDir,
    STORY_GLOB,
    storyRoots,
  );
  const codeFiles = collectRootedProjectFiles(
    projectDir,
    CODE_GLOB,
    sourceRoots,
  );
  const twigFiles = collectRootedProjectFiles(projectDir, TWIG_GLOB, twigRoots);
  const styleFiles = collectRootedProjectFiles(
    projectDir,
    STYLE_GLOB,
    sourceRoots,
  );
  const context = {
    ...envResult,
    projectDir,
    sourceRoots,
    storyRoots,
    twigRoots,
    storyFiles,
    codeFiles,
    twigFiles,
    styleFiles,
    twigThreshold: Number.isFinite(options.twigThreshold)
      ? options.twigThreshold
      : DEFAULT_TWIG_THRESHOLD,
  };
  const findings = [
    ...auditProjectConfig(context),
    ...auditPackageOverrides(context),
    ...auditGeneratedPackageScripts(context),
    ...auditStoryDiscovery(context),
    ...auditLegacyTwigStories(context),
    ...auditTwigReferences(context),
    ...auditCssAssetReferences(context),
    ...auditWebpackPatterns(context),
    ...auditCoreImports(context),
    ...auditDrupalAssumptions(context),
    ...auditFilesOutsideRoots(context),
    ...auditTwigVolume(context),
  ];
  const summary = findings.reduce(
    (totals, finding) => ({
      ...totals,
      [finding.severity]: (totals[finding.severity] || 0) + 1,
    }),
    {
      error: 0,
      warn: 0,
      info: 0,
    },
  );

  return {
    projectDir,
    summary,
    files: {
      stories: storyFiles.length,
      twig: twigFiles.length,
      code: codeFiles.length,
      styles: styleFiles.length,
    },
    findings,
  };
}

/**
 * Format one finding for terminal output.
 *
 * @param {object} finding - Finding to format.
 * @param {string} projectDir - Project root.
 * @returns {string[]} Output lines.
 */
function formatFinding(finding, projectDir) {
  const location = finding.filePath
    ? `${displayPath(projectDir, finding.filePath)}${
        finding.line ? `:${finding.line}` : ''
      }`
    : 'project';
  const lines = [
    `[${finding.severity}] ${finding.id}`,
    `  ${location}`,
    `  ${finding.message}`,
  ];

  for (const detail of finding.details || []) {
    lines.push(`  ${detail}`);
  }
  if (finding.docs) {
    lines.push(`  Docs: ${finding.docs}`);
  }

  return lines;
}

/**
 * Format the combined audit report.
 *
 * @param {{projectDir: string, summary: object, files: object, findings: object[]}} result
 * Audit result.
 * @returns {string} Human-readable report.
 */
export function formatAuditReport(result) {
  const lines = [
    'Emulsify project audit',
    `Project: ${result.projectDir}`,
    `Scanned ${result.files.stories} story file(s), ${result.files.twig} Twig file(s), ${result.files.code} code file(s), and ${result.files.styles} style file(s).`,
    `Findings: ${result.summary.error} error(s), ${result.summary.warn} warning(s), ${result.summary.info} info item(s).`,
  ];

  if (!result.findings.length) {
    lines.push('No audit findings found.');
    return lines.join('\n');
  }

  for (const finding of result.findings) {
    lines.push('', ...formatFinding(finding, result.projectDir));
  }

  return lines.join('\n');
}

/**
 * CLI usage text.
 *
 * @returns {string} Usage text.
 */
function usage() {
  return [
    'Usage: emulsify-audit [--root <dir>] [--json] [--fail-on-found] [--twig-threshold <count>]',
    '',
    'Options:',
    '  --root <dir>              Project root to scan. Defaults to the current directory.',
    '  --json                    Print machine-readable JSON.',
    '  --fail-on-found           Exit with code 1 when any finding is reported.',
    `  --twig-threshold <count>  Warn when Storybook roots contain more than this many Twig files. Default: ${DEFAULT_TWIG_THRESHOLD}.`,
    '  --help                    Print this help text.',
  ].join('\n');
}

/**
 * Parse command-line arguments.
 *
 * @param {string[]} argv - CLI arguments.
 * @returns {object} Parsed options.
 */
function parseArgs(argv) {
  const options = {
    projectDir: process.cwd(),
    failOnFound: false,
    json: false,
    help: false,
    twigThreshold: DEFAULT_TWIG_THRESHOLD,
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
    if (arg === '--twig-threshold') {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value)) {
        throw new Error('--twig-threshold requires a number.');
      }
      options.twigThreshold = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--twig-threshold=')) {
      const value = Number(arg.slice('--twig-threshold='.length));
      if (!Number.isFinite(value)) {
        throw new Error('--twig-threshold requires a number.');
      }
      options.twigThreshold = value;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
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

  const result = auditProject(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatAuditReport(result));
  }

  return options.failOnFound && result.findings.length ? 1 : 0;
}

if (process.argv[1]?.split(/[\\/]/).pop() === 'audit.js') {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error.message || error);
    console.error('');
    console.error(usage());
    process.exitCode = 1;
  }
}
