/**
 * @file Shared CSS and Sass `url()` tokenization.
 *
 * A regular expression can recognize the contents of `url()`, but it cannot
 * tell whether the function-shaped text sits inside a comment or string. This
 * scanner supplies that missing lexical context while preserving exact source
 * offsets for both build rewrites and audit fixes.
 */

/** Characters that keep `url` inside a larger CSS identifier. */
const IDENT_CHAR_RE = /[\w\-\u0080-\uffff]/;

/** CSS whitespace accepted around a URL value. */
const WHITESPACE_RE = /\s/;

/** Quote delimiters accepted by CSS URL and string tokens. */
const SINGLE_QUOTE = String.fromCharCode(39);
const DOUBLE_QUOTE = '"';

/**
 * Determine whether a character opens a quoted CSS value.
 *
 * @param {string|undefined} character - Candidate character.
 * @returns {boolean} TRUE for a single or double quote.
 */
const isQuote = (character) =>
  character === SINGLE_QUOTE || character === DOUBLE_QUOTE;

/**
 * Trim a token value while keeping its offsets in the original source.
 *
 * @param {string} source - Full stylesheet source.
 * @param {number} start - Untrimmed value start.
 * @param {number} end - Untrimmed value end.
 * @returns {{value: string, valueStart: number, valueEnd: number}} Trimmed value and offsets.
 */
function trimValue(source, start, end) {
  const untrimmed = source.slice(start, end);
  const value = untrimmed.trim();
  const leading = untrimmed.length - untrimmed.trimStart().length;

  return {
    value,
    valueStart: start + leading,
    valueEnd: start + leading + value.length,
  };
}

/**
 * Parse a `url()` token beginning at an eligible source position.
 *
 * The argument is consumed atomically so `//` inside `url(https://...)` is not
 * mistaken for a Sass comment. Backslash escapes keep quotes and closing
 * parentheses from ending an argument early.
 *
 * @param {string} source - Full stylesheet source.
 * @param {number} start - Candidate `u` offset.
 * @returns {{start: number, end: number, valueStart: number, valueEnd: number, value: string, quote: string, match: string}|undefined} Parsed token.
 */
function urlTokenAt(source, start) {
  if (!source.startsWith('url(', start)) return undefined;
  if (start > 0 && IDENT_CHAR_RE.test(source[start - 1])) return undefined;

  const innerStart = start + 4;
  let cursor = innerStart;

  while (cursor < source.length && WHITESPACE_RE.test(source[cursor])) {
    cursor += 1;
  }

  const quote = isQuote(source[cursor]) ? source[cursor] : '';
  let valueStart;
  let valueEnd;
  let value;

  if (quote) {
    const quotedValueStart = cursor + 1;
    cursor = quotedValueStart;

    while (cursor < source.length && source[cursor] !== quote) {
      cursor += source[cursor] === '\\' && cursor + 1 < source.length ? 2 : 1;
    }

    if (source[cursor] !== quote) return undefined;

    ({ value, valueStart, valueEnd } = trimValue(
      source,
      quotedValueStart,
      cursor,
    ));
    cursor += 1;

    while (cursor < source.length && WHITESPACE_RE.test(source[cursor])) {
      cursor += 1;
    }
  } else {
    cursor = innerStart;

    while (cursor < source.length && source[cursor] !== ')') {
      if (isQuote(source[cursor])) return undefined;
      cursor += source[cursor] === '\\' && cursor + 1 < source.length ? 2 : 1;
    }

    if (cursor === innerStart) return undefined;

    ({ value, valueStart, valueEnd } = trimValue(source, innerStart, cursor));
  }

  if (source[cursor] !== ')') return undefined;

  const end = cursor + 1;

  return {
    start,
    end,
    valueStart,
    valueEnd,
    value,
    quote,
    match: source.slice(start, end),
  };
}

/**
 * Mask comments without changing any source offsets.
 *
 * @param {string} source - Full stylesheet source.
 * @param {Array<{start: number, end: number}>} comments - Comment ranges.
 * @returns {string} Source with non-newline comment characters blanked.
 */
function maskComments(source, comments) {
  if (!comments.length) return source;

  const masked = source.split('');

  for (const { start, end } of comments) {
    for (let index = start; index < end; index += 1) {
      if (masked[index] !== '\n') masked[index] = ' ';
    }
  }

  return masked.join('');
}

/**
 * Tokenize real `url()` functions in CSS or Sass source.
 *
 * Block comments, `//` comments anywhere on a line, and ordinary quoted
 * strings are skipped. Quoted values belonging to an actual `url()` token are
 * consumed by that token instead of being mistaken for standalone strings.
 *
 * @param {string} source - Stylesheet source.
 * @returns {{urls: Array<{start: number, end: number, valueStart: number, valueEnd: number, value: string, quote: string, match: string}>, sourceWithoutComments: string}} URL tokens and an offset-preserving comment mask.
 */
export function tokenizeStylesheetUrls(source) {
  const urls = [];
  const comments = [];
  let cursor = 0;

  while (cursor < source.length) {
    const next = source[cursor + 1];

    if (source[cursor] === '/' && next === '*') {
      const start = cursor;
      cursor += 2;

      while (
        cursor < source.length &&
        !(source[cursor] === '*' && source[cursor + 1] === '/')
      ) {
        cursor += 1;
      }

      cursor = Math.min(source.length, cursor + 2);
      comments.push({ start, end: cursor });
      continue;
    }

    if (source[cursor] === '/' && next === '/') {
      const start = cursor;
      cursor += 2;
      while (cursor < source.length && source[cursor] !== '\n') cursor += 1;
      comments.push({ start, end: cursor });
      continue;
    }

    if (isQuote(source[cursor])) {
      const quote = source[cursor];
      cursor += 1;

      while (cursor < source.length && source[cursor] !== quote) {
        cursor += source[cursor] === '\\' && cursor + 1 < source.length ? 2 : 1;
      }

      if (source[cursor] === quote) cursor += 1;
      continue;
    }

    const url = urlTokenAt(source, cursor);
    if (url) {
      urls.push(url);
      cursor = url.end;
      continue;
    }

    cursor += 1;
  }

  return {
    urls,
    sourceWithoutComments: maskComments(source, comments),
  };
}

/**
 * Replace real stylesheet URL tokens without disturbing ignored lookalikes.
 *
 * @param {string} source - Stylesheet source.
 * @param {(token: {start: number, end: number, valueStart: number, valueEnd: number, value: string, quote: string, match: string}) => string|undefined} replacer - Token callback.
 * @returns {string} Rewritten source, or the original string when unchanged.
 */
export function replaceStylesheetUrlTokens(source, replacer) {
  const { urls } = tokenizeStylesheetUrls(source);
  let cursor = 0;
  let rewritten = '';
  let changed = false;

  for (const token of urls) {
    const replacement = replacer(token);
    if (typeof replacement !== 'string' || replacement === token.match) {
      continue;
    }

    rewritten += source.slice(cursor, token.start) + replacement;
    cursor = token.end;
    changed = true;
  }

  return changed ? rewritten + source.slice(cursor) : source;
}
