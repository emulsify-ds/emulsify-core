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
 * Read complete literal candidates and retain uncertainty within a fallback list.
 *
 * @param {object} argument - Argument text and source offset.
 * @param {string} source - Comment-masked Twig source.
 * @param {boolean} [allowArray=true] - Whether the function accepts fallbacks.
 * @returns {object} Static candidates, array status, and dynamic-candidate flag.
 */
function readTwigCandidates(argument, source, allowArray = true) {
  const result = {
    candidates: [],
    isFallbackArray: false,
    hasDynamicCandidates: false,
  };
  if (!argument) return { ...result, hasDynamicCandidates: true };
  let values = [argument];
  if (argument.text.trimStart().startsWith('[')) {
    const arrayStart = argument.offset + argument.text.indexOf('[');
    const array = readTwigList(source, arrayStart + 1, ']');
    const argumentEnd = argument.offset + argument.text.length;
    if (!allowArray || !array || source.slice(array.end, argumentEnd).trim()) {
      return { ...result, hasDynamicCandidates: true };
    }
    result.isFallbackArray = true;
    values = array.values;
  }

  for (const [index, { text, offset }] of values.entries()) {
    // An empty array and a trailing comma do not introduce a dynamic candidate.
    if (result.isFallbackArray && index === values.length - 1 && !text.trim()) {
      continue;
    }
    const value = staticTwigString(text);
    if (value === null) {
      result.hasDynamicCandidates = true;
    } else {
      result.candidates.push({
        value,
        line: lineNumberAt(
          source,
          offset + text.length - text.trimStart().length,
        ),
      });
    }
  }
  return result;
}

/**
 * Recognize literal optionality using Core's JavaScript truthiness coercion.
 *
 * @param {object|undefined|null} argument - Argument, absent value, or unknown.
 * @returns {boolean|null} Static boolean, or null when unknown.
 */
function staticTwigBoolean(argument) {
  if (argument === undefined) return false;
  const text = argument?.text.trim();
  if (text === undefined) return null;
  if (/^(?:true|TRUE)$/.test(text)) return true;
  if (/^(?:false|FALSE|null|NULL|none|NONE)$/.test(text)) return false;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Boolean(Number(text));
  const literal = staticTwigString(text);
  if (literal !== null) return Boolean(literal);
  return null;
}

/**
 * Read an option from a complete object literal in Twig.js property order.
 *
 * @param {object|undefined|null} argument - Object argument or unknown value.
 * @param {string} name - Option key.
 * @param {string} source - Comment-masked Twig source.
 * @returns {object|undefined|null} Option expression, absent option, or unknown.
 */
function readTwigObjectOption(argument, name, source) {
  if (argument === undefined) return undefined;
  if (argument === null) return null;
  const text = argument.text.trim();
  if (!text.startsWith('{')) {
    // Core normalizes primitive/array variables to an empty variables object.
    if (staticTwigBoolean(argument) !== null) {
      return undefined;
    }
    if (text.startsWith('[')) {
      const start = argument.offset + argument.text.indexOf('[');
      const array = readTwigList(source, start + 1, ']');
      if (
        array &&
        !source.slice(array.end, argument.offset + argument.text.length).trim()
      ) {
        return undefined;
      }
    }
    return null;
  }

  const start = argument.offset + argument.text.indexOf('{');
  const object = readTwigList(source, start + 1, '}');
  if (
    !object ||
    source.slice(object.end, argument.offset + argument.text.length).trim()
  )
    return null;
  // Twig.js keeps the first value for duplicate object keys. A preceding
  // computed key may already define this option, so it remains unknown.
  for (const property of object.values) {
    if (!property.text.trim()) continue;
    const key = readTwigList(source, property.offset, ':');
    if (!key || key.values.length !== 1) return null;
    const keyText = key.values[0].text.trim();
    const propertyName = /^[A-Za-z_]\w*$/.test(keyText)
      ? keyText
      : staticTwigString(keyText);
    if (propertyName === null) return null;
    if (propertyName === name) {
      return {
        text: source.slice(key.end, property.offset + property.text.length),
        offset: key.end,
      };
    }
  }
  return undefined;
}

/**
 * Read supported Core optional-missing arguments, including include options.
 *
 * @param {string} type - include or source.
 * @param {object[]} args - Complete arguments with source offsets.
 * @param {string} source - Comment-masked Twig source.
 * @returns {boolean|null} Optional, required, or unknown.
 */
function readIgnoreMissing(type, args, source) {
  // Twig.js does not bind native named parameters: colon pairs become positional
  // tokens and equals syntax does not compile. Do not infer flags from those
  // accidental positions; keep unsupported calls explicitly unknown.
  if (args.some(({ text }) => /^\s*[A-Za-z_]\w*\s*[:=]/.test(text)))
    return null;
  if (type === 'source') return staticTwigBoolean(args[1]);

  let ignoreMissing = staticTwigBoolean(args[3]);
  const variableFlag = readTwigObjectOption(args[1], 'ignore_missing', source);
  if (variableFlag !== undefined)
    ignoreMissing = staticTwigBoolean(variableFlag);

  // This precedence mirrors Core's normalizeIncludeOptions: variables can
  // replace withContext before a third-argument options object is inspected.
  const variableContext = readTwigObjectOption(args[1], 'with_context', source);
  const withContext = variableContext === undefined ? args[2] : variableContext;
  const contextFlag = readTwigObjectOption(
    withContext,
    'ignore_missing',
    source,
  );
  if (contextFlag !== undefined) ignoreMissing = staticTwigBoolean(contextFlag);
  return ignoreMissing;
}

/**
 * Scan actual Twig calls while keeping their argument boundaries and locations.
 *
 * @param {string} source - Twig source.
 * @returns {object} Masked source and complete calls.
 */
function scanTwigReferenceCalls(source) {
  const calls = [];
  const maskedSource = maskTwigSource(source);
  const callSource = maskTwigSource(source, true);
  const callPattern = /\b(include|source)\s*\(/g;

  let callMatch;
  while ((callMatch = callPattern.exec(callSource))) {
    if (callSource.slice(0, callMatch.index).trimEnd().endsWith('.')) continue;
    const argsStart = callMatch.index + callMatch[0].length;
    const call = readTwigList(maskedSource, argsStart, ')');
    if (!call) continue;
    const args = [...call.values];
    if (!args.at(-1)?.text.trim()) args.pop();
    calls.push({
      type: callMatch[1],
      args,
      line: lineNumberAt(source, callMatch.index),
    });
  }
  return { calls, maskedSource };
}

/**
 * Preserve the flat static-reference interface exported by the audit entrypoint.
 *
 * This compatibility view intentionally retains individual array literals and
 * optional references. The audit check uses the richer call view below.
 *
 * @param {string} source - Twig source.
 * @returns {{type: string, value: string, line: number}[]} Static references.
 */
export function findTwigIncludeSourceReferences(source) {
  const { calls, maskedSource } = scanTwigReferenceCalls(source);
  return calls.flatMap(({ type, args }) =>
    readTwigCandidates(args[0], maskedSource).candidates.map((candidate) => ({
      type,
      ...candidate,
    })),
  );
}

/**
 * Extract call-level reference semantics without compiling or rendering Twig.
 *
 * Candidate lines locate literals; the call line locates a grouped finding.
 * Source only accepts a scalar name, unlike include's ordered fallback list.
 * Dynamic candidates or optionality remain explicit internal unknown states.
 *
 * @param {string} source - Twig source.
 * @returns {object[]} Calls, candidates, optionality, and source locations.
 */
export function findTwigReferenceCalls(source) {
  const { calls, maskedSource } = scanTwigReferenceCalls(source);
  return calls.map(({ type, args, line }) => ({
    type,
    line,
    ...readTwigCandidates(args[0], maskedSource, type === 'include'),
    ignoreMissing: readIgnoreMissing(type, args, maskedSource),
  }));
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
