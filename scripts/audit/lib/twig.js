/**
 * @file Twig reference parsing and resolution helpers for the project audit.
 */

import { dirname, resolve } from 'node:path';
import {
  resolveAssetRoots,
  toAbsoluteAssetRoot,
} from '../../../config/vite/utils/asset-roots.js';
import { safeExists } from '../../../config/vite/utils/fs-safe.js';
import { resolveComponentReference } from '../../../config/vite/utils/twig-component-resolver.js';
import { candidateKeysForReference } from '../../../src/storybook/twig/reference-paths.js';
import { lineNumberAt } from '../../lib/text.js';
import { isSameOrInside } from './files.js';

const GENERATED_ASSET_ALIASES = new Set(['icons.svg']);

/**
 * Mask Twig comments without changing offsets or line breaks.
 *
 * Quotes inside Twig expressions protect literal comment markers. HTML quotes
 * do not, because Twig comments can also appear inside HTML attributes.
 *
 * @param {string} source - Twig source.
 * @param {boolean} [codeOnly=false] - Also mask quoted strings and non-Twig text.
 * @returns {string} Source with comment text replaced by whitespace.
 */
function maskTwigSource(source, codeOnly = false) {
  const characters = source.split('');
  let closingTag = '';
  let quote = '';

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const pair = source.slice(index, index + 2);
    if (codeOnly && (quote || !closingTag) && char !== '\n' && char !== '\r') {
      characters[index] = ' ';
    }
    if (quote) {
      if (char === '\\') {
        index += 1;
        if (
          codeOnly &&
          index < source.length &&
          source[index] !== '\n' &&
          source[index] !== '\r'
        ) {
          characters[index] = ' ';
        }
      } else if (char === quote) quote = '';
    } else if (pair === '{#') {
      const close = source.indexOf('#}', index + 2);
      const end = close === -1 ? source.length : close + 2;
      for (; index < end; index += 1) {
        if (source[index] !== '\n' && source[index] !== '\r') {
          characters[index] = ' ';
        }
      }
      index -= 1;
    } else if (!closingTag && (pair === '{{' || pair === '{%')) {
      closingTag = pair === '{{' ? '}}' : '%}';
      index += 1;
    } else if (closingTag && pair === closingTag) {
      closingTag = '';
      index += 1;
    } else if (closingTag && (char === '"' || char.charCodeAt(0) === 39)) {
      quote = char;
      if (codeOnly) characters[index] = ' ';
    }
  }

  return characters.join('');
}

/**
 * Read comma-separated call arguments or array elements and their offsets.
 *
 * Nested delimiters and quoted punctuation do not terminate a value. An
 * incomplete or mismatched list is ignored rather than audited in fragments.
 *
 * @param {string} source - Comment-masked Twig source.
 * @param {number} start - Offset immediately after the opening delimiter.
 * @param {string} closing - Closing delimiter for this list.
 * @returns {{values: {text: string, offset: number}[], end: number}|null} List.
 */
function readTwigList(source, start, closing) {
  const values = [];
  const closings = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  let quote = '';
  let offset = start;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char.charCodeAt(0) === 39) {
      quote = char;
    } else if (closings[char]) {
      stack.push(closings[char]);
    } else if (!stack.length && (char === ',' || char === closing)) {
      values.push({ text: source.slice(offset, index), offset });
      if (char === closing) return { values, end: index + 1 };
      offset = index + 1;
    } else if (')]}'.includes(char) && stack.pop() !== char) {
      return null;
    }
  }

  return null;
}

/**
 * Return a complete static string literal, excluding Twig interpolation.
 *
 * @param {string} expression - One complete argument or array element.
 * @returns {string|null} Literal value, or null for a dynamic expression.
 */
function staticTwigString(expression) {
  const literal = expression
    .trim()
    .match(/^(['"])((?:\\[\s\S]|(?!\1)[^\\])*)\1$/);
  if (!literal) return null;

  const [, quote, value] = literal;
  if (quote === '"' && value.replace(/\\[\s\S]/g, '').includes('#{')) {
    return null;
  }

  // Match Twig.js's string token decoding without compiling the template.
  return value
    .replace(`\\${quote}`, quote)
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r');
}

/**
 * Extract only complete static first arguments to include() or source().
 *
 * Fallback arrays contribute only their complete static string elements.
 * Context arguments and dynamic expressions are not template references.
 *
 * @param {string} source - Twig source.
 * @returns {{type: string, value: string, line: number}[]} References.
 */
export function findTwigIncludeSourceReferences(source) {
  const references = [];
  const maskedSource = maskTwigSource(source);
  const callSource = maskTwigSource(source, true);
  const callPattern = /\b(include|source)\s*\(/g;

  let callMatch;
  while ((callMatch = callPattern.exec(callSource))) {
    if (callSource.slice(0, callMatch.index).trimEnd().endsWith('.')) continue;
    const argsStart = callMatch.index + callMatch[0].length;
    const call = readTwigList(maskedSource, argsStart, ')');
    if (!call) continue;

    const first = call.values[0];
    let values = [first];
    if (first.text.trimStart().startsWith('[')) {
      const arrayStart = first.offset + first.text.indexOf('[');
      const array = readTwigList(maskedSource, arrayStart + 1, ']');
      const firstEnd = first.offset + first.text.length;
      if (!array || maskedSource.slice(array.end, firstEnd).trim()) continue;
      values = array.values;
    }

    for (const { text, offset } of values) {
      const value = staticTwigString(text);
      if (value === null) continue;
      references.push({
        type: callMatch[1],
        value,
        line: lineNumberAt(
          source,
          offset + text.length - text.trimStart().length,
        ),
      });
    }
  }

  return references;
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

  for (const match of maskTwigSource(source).matchAll(pattern)) {
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
 * @param {Map<string, string[]>} [componentGroupRootsCache] - Directory cache shared across one audit pass.
 * @returns {boolean} TRUE when a candidate exists.
 */
export function resolvesTwigReference(
  reference,
  filePath,
  env,
  componentGroupRootsCache = new Map(),
) {
  if (!reference || /^https?:\/\//i.test(reference)) return true;

  if (reference.startsWith('@assets/')) {
    return resolvesAssetReference(reference, env);
  }

  const isRelative = reference.startsWith('./') || reference.startsWith('../');
  const candidates = isRelative
    ? relativeTwigCandidates(filePath, reference)
    : candidateKeysToFiles(candidateKeysForReference(reference, env), env);

  if (candidates.some(safeExists)) return true;
  if (isRelative || !(env.singleDirectoryComponents || env.SDC)) return false;

  return Boolean(
    resolveComponentReference(
      reference,
      env.projectStructure?.namespaceRoots || env.namespaceRoots || {},
      componentGroupRootsCache,
    ),
  );
}
