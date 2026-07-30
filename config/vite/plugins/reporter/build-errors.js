/**
 * @file Build error extraction for the Emulsify develop reporter.
 *
 * Rolldown reports a failed build as a single wrapper error whose message is
 * `Build failed with N errors:` followed by every error rendered as text. Read
 * naively, the reporter shows one error with a message that names a count and
 * nothing else.
 *
 * The individual errors are reachable through the wrapper's `errors` property,
 * and each one carries a `cause` chain that ends at the original Sass
 * exception. That exception is fully structured — `span.url`, `span.start.line`
 * and `span.text` give the file, the line, and the offending statement
 * verbatim — so nothing has to be scraped out of formatted output.
 *
 * @see https://github.com/rolldown/rolldown - aggregateBindingErrorsIntoJsError
 */

import { fileURLToPath } from 'node:url';

/**
 * Matches Sass's "missing import" failure.
 *
 * @type {RegExp}
 */
const MISSING_IMPORT = /Can't find stylesheet to import/i;

/**
 * Captures the specifier from a `@use`, `@forward`, or `@import` statement.
 *
 * @type {RegExp}
 */
const IMPORT_SPECIFIER = /@(?:use|forward|import)\s+['"]([^'"]+)['"]/;

/**
 * Captures a line number and its source from a Sass code frame.
 *
 * Used only when the structured span is unavailable.
 *
 * @type {RegExp}
 */
const FRAME_LINE = /^\s*(\d+)\s*│\s?(.*)$/m;

/**
 * Maximum depth walked through `cause` chains.
 *
 * @type {number}
 */
const MAX_CAUSE_DEPTH = 10;

/**
 * Captures the minifier name Vite prefixes onto a CSS minification failure.
 *
 * Both the lightningcss and esbuild paths tag the message this way before
 * rethrowing, and both attach `loc` and `frame` alongside it.
 *
 * @type {RegExp}
 */
const MINIFIER_PREFIX = /^\[((?:lightningcss|esbuild css) minify)\]\s*/;

/**
 * Captures one numbered row of a Vite code frame.
 *
 * @type {RegExp}
 */
const FRAME_ROW = /^\s*(\d+)\s*\|\s?(.*)$/;

/**
 * Captures the caret row that follows the offending row of a code frame.
 *
 * @type {RegExp}
 */
const FRAME_CARET = /^\s*\|\s?(\s*)\^/;

/**
 * Parse a CSS minifier syntax failure.
 *
 * These are unlike every other error the reporter handles: the minifier runs
 * on the concatenated bundle, so `loc.line` is a line of generated CSS and
 * points at no file anyone wrote. What is salvageable is the offending
 * declaration itself, which is enough to search the project for.
 *
 * @param {object} error - Individual build error.
 * @returns {{
 *   minifier: string,
 *   message: string,
 *   bundleLine: number|undefined,
 *   declaration: string|undefined,
 *   caretColumn: number|undefined
 * }|undefined} Parsed syntax error.
 */
export function parseCssSyntaxError(error) {
  const rawMessage = String(error?.message || '');
  const prefix = MINIFIER_PREFIX.exec(rawMessage);
  if (!prefix) return undefined;

  const [firstLine] = rawMessage.replace(MINIFIER_PREFIX, '').split('\n');
  const parsed = {
    minifier: prefix[1],
    message: firstLine.trim(),
    bundleLine:
      typeof error?.loc?.line === 'number' ? error.loc.line : undefined,
    declaration: undefined,
    caretColumn: undefined,
  };

  const rows = String(error?.frame || '').split('\n');

  for (let index = 0; index < rows.length; index += 1) {
    const row = FRAME_ROW.exec(rows[index]);
    if (!row) continue;

    // Without a bundle line, the row carrying a caret beneath it is the one.
    const isOffending =
      parsed.bundleLine == null
        ? FRAME_CARET.test(rows[index + 1] || '')
        : Number(row[1]) === parsed.bundleLine;
    if (!isOffending) continue;

    const leading = row[2].length - row[2].trimStart().length;
    parsed.declaration = row[2].trim();

    const caret = FRAME_CARET.exec(rows[index + 1] || '');
    if (caret) {
      // Re-base the caret against the trimmed declaration.
      parsed.caretColumn = Math.max(0, caret[1].length - leading);
    }

    break;
  }

  return parsed;
}

/**
 * Flatten a rolldown build error into the individual errors it wraps.
 *
 * @param {Error & {errors?: Array<object>}} error - Build error.
 * @returns {Array<object>} Individual errors.
 */
export function flattenBuildErrors(error) {
  if (!error) return [];

  const nested = error.errors;
  if (!Array.isArray(nested) || nested.length === 0) return [error];

  return nested.flatMap((entry) => flattenBuildErrors(entry));
}

/**
 * Walk an error's `cause` chain looking for an entry with a Sass span.
 *
 * @param {object} error - Error to inspect.
 * @returns {object|undefined} Error carrying a Sass span.
 */
function findSpanned(error) {
  let current = error;

  for (let depth = 0; current && depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (current.span?.url || current.span?.start) return current;
    current = current.cause;
  }

  return undefined;
}

/**
 * Convert a Sass span URL to a filesystem path.
 *
 * @param {URL|string|undefined} url - Span URL.
 * @returns {string|undefined} Filesystem path.
 */
function spanPath(url) {
  if (!url) return undefined;
  const href = typeof url === 'string' ? url : url.href;
  if (!href?.startsWith('file:')) return href || undefined;

  try {
    return fileURLToPath(href);
  } catch {
    return href;
  }
}

/**
 * Reduce a message to its first line, without the plugin prefix.
 *
 * @param {string|undefined} message - Raw message.
 * @returns {string} Condensed message.
 */
function condense(message) {
  const [first] = String(message || '').split('\n');
  return first.replace(/^\[[^\]]+\]\s*/, '').trim();
}

/**
 * Describe one build error in the terms the reporter renders.
 *
 * Prefers the structured Sass span and falls back to the rendered code frame,
 * which is the only source of a line number when a plugin re-throws without
 * preserving the original exception.
 *
 * @param {object} error - Individual build error.
 * @returns {{
 *   message: string,
 *   file: string|undefined,
 *   line: number|undefined,
 *   statement: string|undefined,
 *   specifier: string|undefined,
 *   isMissingImport: boolean
 * }} Description.
 */
export function describeBuildError(error) {
  const spanned = findSpanned(error);
  const message = condense(spanned?.message || error?.message);

  let file = spanPath(spanned?.span?.url);
  let line =
    typeof spanned?.span?.start?.line === 'number'
      ? spanned.span.start.line + 1
      : undefined;
  let statement = spanned?.span?.text?.trim();

  if (!file) file = error?.loc?.file || error?.id || undefined;
  if (line == null && typeof error?.loc?.line === 'number') {
    line = error.loc.line;
  }

  if (!statement && error?.frame) {
    const framed = FRAME_LINE.exec(error.frame);
    if (framed) {
      statement = framed[2].trim();
      if (line == null) line = Number(framed[1]);
    }
  }

  return {
    message,
    file,
    line,
    statement,
    specifier: statement ? IMPORT_SPECIFIER.exec(statement)?.[1] : undefined,
    isMissingImport: MISSING_IMPORT.test(message),
  };
}

/**
 * Split a build failure into missing imports and everything else.
 *
 * Missing imports get their own table because they share a shape — a file, a
 * line, and a path that does not resolve — and because one deleted partial
 * commonly produces a dozen of them.
 *
 * @param {Error & {errors?: Array<object>}} error - Build error.
 * @returns {{
 *   importErrors: Array<object>,
 *   syntaxErrors: Array<object>,
 *   otherErrors: Array<object>
 * }} Classified errors.
 */
export function classifyBuildError(error) {
  const importErrors = [];
  const syntaxErrors = [];
  const otherErrors = [];

  for (const entry of flattenBuildErrors(error)) {
    const syntaxError = parseCssSyntaxError(entry);
    if (syntaxError) {
      syntaxErrors.push(syntaxError);
      continue;
    }

    const described = describeBuildError(entry);

    // A missing import with no specifier cannot be tabulated, so it falls
    // through to the general error list rather than showing a blank row.
    if (described.isMissingImport && described.specifier) {
      importErrors.push(described);
    } else {
      otherErrors.push(described);
    }
  }

  return { importErrors, syntaxErrors, otherErrors };
}
