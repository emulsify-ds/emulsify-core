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

/** URL values that cannot name a local file. */
const NON_FILESYSTEM_URL_RE = /^(?:#|\/\/|[a-z][a-z0-9+.-]*:|var\(|env\()/i;

/**
 * Determine whether a character opens a quoted CSS value.
 *
 * @param {string|undefined} character - Candidate character.
 * @returns {boolean} TRUE for a single or double quote.
 */
const isQuote = (character) =>
  character === SINGLE_QUOTE || character === DOUBLE_QUOTE;

/**
 * Determine whether a character ends an unterminated CSS string.
 *
 * CSS preprocessing treats carriage return, form feed, and line feed as
 * newlines. Handling all three here keeps recovery correct before preprocessing.
 *
 * @param {string|undefined} character - Candidate character.
 * @returns {boolean} TRUE for a CSS newline.
 */
const isCssNewline = (character) =>
  character === '\n' || character === '\r' || character === '\f';

/**
 * Determine whether a case-insensitive CSS `url(` function starts at an offset.
 *
 * Comparing individual characters avoids allocating and lowercasing a slice at
 * every source position.
 *
 * @param {string} source - Full stylesheet source.
 * @param {number} start - Candidate `u` offset.
 * @returns {boolean} TRUE when `url(` begins at the offset.
 */
const isUrlFunctionAt = (source, start) =>
  (source[start] === 'u' || source[start] === 'U') &&
  (source[start + 1] === 'r' || source[start + 1] === 'R') &&
  (source[start + 2] === 'l' || source[start + 2] === 'L') &&
  source[start + 3] === '(';

/**
 * Scan a CSS string through its closing quote or an unescaped newline.
 *
 * A backslash-newline is a continuation, including the raw CRLF form that CSS
 * preprocessing normally collapses before tokenization.
 *
 * @param {string} source - Full stylesheet source.
 * @param {number} cursor - First character after the opening quote.
 * @param {string} quote - Opening quote character.
 * @returns {number} Closing quote, newline, or EOF offset.
 */
function scanCssString(source, cursor, quote) {
  while (
    cursor < source.length &&
    source[cursor] !== quote &&
    !isCssNewline(source[cursor])
  ) {
    if (source[cursor] !== '\\' || cursor + 1 >= source.length) {
      cursor += 1;
      continue;
    }

    cursor +=
      source[cursor + 1] === '\r' && source[cursor + 2] === '\n' ? 3 : 2;
  }

  return cursor;
}

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
 * @param {{invalidUnquotedUntil: number, noClosingParenthesisAfter: number}} scanState - Per-stylesheet failure memo.
 * @returns {{start: number, end: number, valueStart: number, valueEnd: number, value: string, quote: string, match: string}|undefined} Parsed token.
 */
function urlTokenAt(source, start, scanState) {
  if (!isUrlFunctionAt(source, start)) return undefined;
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
    cursor = scanCssString(source, quotedValueStart, quote);

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

    // A prior unquoted candidate reached a quote without encountering `)`.
    // Every later unquoted candidate inside that interval must hit the same
    // quote first, so rescanning it cannot produce a token.
    if (innerStart <= scanState.invalidUnquotedUntil) return undefined;

    // A prior candidate already scanned this suffix to EOF without finding an
    // unescaped `)`. Failing immediately keeps repeated malformed `url(` input
    // linear instead of rescanning the same tail for every character.
    if (innerStart >= scanState.noClosingParenthesisAfter) return undefined;

    while (cursor < source.length && source[cursor] !== ')') {
      if (isQuote(source[cursor])) {
        scanState.invalidUnquotedUntil = Math.max(
          scanState.invalidUnquotedUntil,
          cursor,
        );
        return undefined;
      }
      cursor += source[cursor] === '\\' && cursor + 1 < source.length ? 2 : 1;
    }

    if (cursor >= source.length) {
      scanState.noClosingParenthesisAfter = Math.min(
        scanState.noClosingParenthesisAfter,
        innerStart,
      );
      return undefined;
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
 * Determine whether a stylesheet URL can never name a file on disk.
 *
 * Sass variables are meaningful in unquoted `url()` values. In a quoted value,
 * `$` is ordinary filename data and must reach the filesystem classifier. An
 * unresolved interpolation is skipped in either form because neither consumer
 * can safely guess what path it represents.
 *
 * @param {string} value - URL value without its surrounding quotes.
 * @param {string} [quote=''] - Token quote, or an empty string when unquoted.
 * @returns {boolean} TRUE when the value is not a filesystem path.
 */
export function isNonFilesystemCssUrl(value, quote = '') {
  const trimmed = String(value || '').trim();

  return (
    !trimmed ||
    NON_FILESYSTEM_URL_RE.test(trimmed) ||
    trimmed.includes('#{') ||
    (!quote && trimmed.includes('$'))
  );
}

/**
 * Tokenize real `url()` functions in CSS or Sass source.
 *
 * Block comments, `//` comments anywhere on a line, and ordinary quoted
 * strings are skipped. Quoted values belonging to an actual `url()` token are
 * consumed by that token instead of being mistaken for standalone strings.
 *
 * @param {string} source - Stylesheet source.
 * @returns {{urls: Array<{start: number, end: number, valueStart: number, valueEnd: number, value: string, quote: string, match: string}>, readonly sourceWithoutComments: string}} URL tokens and a lazily computed, offset-preserving comment mask.
 */
export function tokenizeStylesheetUrls(source) {
  const urls = [];
  const comments = [];
  const scanState = {
    invalidUnquotedUntil: -1,
    noClosingParenthesisAfter: Number.POSITIVE_INFINITY,
  };
  let maskedSource;
  let cursor = 0;

  while (cursor < source.length) {
    const next = source[cursor + 1];

    if (source[cursor] === '/' && next === '*') {
      const start = cursor;
      cursor += 2;

      // CSS consumes an unterminated block comment through EOF. Unlike a bad
      // string, it deliberately does not recover at the next newline.
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
      cursor = scanCssString(source, cursor + 1, quote);

      if (source[cursor] === quote) cursor += 1;
      continue;
    }

    const url = urlTokenAt(source, cursor, scanState);
    if (url) {
      urls.push(url);
      cursor = url.end;
      continue;
    }

    cursor += 1;
  }

  return {
    urls,
    get sourceWithoutComments() {
      maskedSource ??= maskComments(source, comments);
      return maskedSource;
    },
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
