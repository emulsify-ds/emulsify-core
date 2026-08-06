/**
 * @file Twig reference parsing and resolution helpers for the project audit.
 */

import { dirname, resolve } from 'node:path';
import {
  resolveAssetRoots,
  toAbsoluteAssetRoot,
} from '../../../config/vite/utils/asset-roots.js';
import { safeExists } from '../../../config/vite/utils/fs-safe.js';
import { candidateKeysForReference } from '../../../src/storybook/twig/reference-paths.js';
import { lineNumberAt } from '../../lib/text.js';
import { isSameOrInside } from './files.js';

const GENERATED_ASSET_ALIASES = new Set(['icons.svg']);

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
 * Resolve an audit asset root using Storybook's root-relative convention.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string} assetRoot - Configured, absolute, or project-relative root.
 * @returns {string} Absolute filesystem path, or an empty string.
 */
export function resolveAuditAssetRoot(projectDir, assetRoot) {
  return toAbsoluteAssetRoot(projectDir, assetRoot);
}

/**
 * Return filesystem roots that Storybook can use for @assets source() calls.
 *
 * Existence filtering stays off here because callers do their own directory
 * check, and a configured-but-missing root is worth reporting rather than
 * silently dropping.
 *
 * @param {object} env - Normalized environment.
 * @param {object} [options={}] - Asset root options.
 * @param {boolean} [options.includeGenerated=false] - Include generated roots.
 * @returns {string[]} Absolute asset roots.
 */
export function auditAssetRoots(env = {}, { includeGenerated = false } = {}) {
  return resolveAssetRoots(env, { includeGenerated, existingOnly: false });
}

/**
 * Determine whether an @assets reference resolves through Storybook asset roots.
 *
 * @param {string} reference - Twig @assets reference.
 * @param {object} env - Normalized environment.
 * @returns {boolean} TRUE when a candidate exists.
 */
function resolvesAssetReference(reference, env) {
  const relAsset = reference.replace(/^@assets\//, '');
  if (!relAsset) return false;
  const includeGenerated = GENERATED_ASSET_ALIASES.has(relAsset);

  return auditAssetRoots(env, { includeGenerated }).some((root) => {
    const candidate = resolve(root, relAsset);

    return isSameOrInside(candidate, root) && safeExists(candidate);
  });
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
    return resolvesAssetReference(reference, env);
  }

  const candidates =
    reference.startsWith('./') || reference.startsWith('../')
      ? relativeTwigCandidates(filePath, reference)
      : candidateKeysToFiles(candidateKeysForReference(reference, env), env);

  return candidates.some(safeExists);
}
