/**
 * @file Tests for the shared CSS URL tokenizer.
 */

import { performance } from 'node:perf_hooks';

import {
  isNonFilesystemCssUrl,
  replaceStylesheetUrlTokens,
  tokenizeStylesheetUrls,
} from './css-urls.js';

const SINGLE_QUOTE = String.fromCharCode(39);
const PATHOLOGICAL_URL_COUNT = 40_000;
const PERFORMANCE_BUDGET_MS = 1_000;

const valuesIn = (source) =>
  tokenizeStylesheetUrls(source).urls.map(({ value }) => value);

describe('isNonFilesystemCssUrl', () => {
  it.each([
    [
      'a quoted dollar filename',
      'assets/images/logo$2x.svg',
      SINGLE_QUOTE,
      false,
    ],
    ['an unquoted dollar expression', 'assets/images/logo$2x.svg', '', true],
    ['an unquoted Sass variable', '$asset-path', '', true],
    [
      'unresolved Sass interpolation',
      'assets/images/#{$name}.svg',
      SINGLE_QUOTE,
      true,
    ],
    ['a data URI', 'data:image/svg+xml,%3Csvg%3E', '', true],
    ['a local asset path', '/assets/images/logo.svg', SINGLE_QUOTE, false],
  ])('classifies %s', (_label, value, quote, expected) => {
    expect(isNonFilesystemCssUrl(value, quote)).toBe(expected);
  });
});

describe('tokenizeStylesheetUrls', () => {
  it.each([
    ['double-quoted', '"'],
    ['single-quoted', SINGLE_QUOTE],
  ])('recovers from a top-level unterminated %s string', (_label, quote) => {
    const source = [
      `.bad { content: ${quote}unfinished`,
      '.real { background: url(/assets/real.png); }',
    ].join('\n');

    expect(valuesIn(source)).toEqual(['/assets/real.png']);
  });

  it('recovers from an unterminated quoted URL value', () => {
    const source = [
      '.bad { background: url("/assets/unfinished.png',
      '.real { background: url(/assets/real.png); }',
    ].join('\n');

    expect(valuesIn(source)).toEqual(['/assets/real.png']);
  });

  it('bounds an apostrophe in an unquoted URL to its line', () => {
    const source = [
      `.bad { background: url(/assets/rock${SINGLE_QUOTE}n.png); }`,
      '.real { background: url(/assets/after.png); }',
    ].join('\n');

    expect(valuesIn(source)).toEqual(['/assets/after.png']);
  });

  it.each([
    ['line feed', '\n'],
    ['carriage-return line feed', '\r\n'],
  ])('keeps a backslash-%s inside the string', (_label, newline) => {
    const source = [
      '.bad { content: "still hidden\\',
      'url(/assets/hidden.png)"; }',
      '.real { background: url(/assets/real.png); }',
    ].join(newline);

    expect(valuesIn(source)).toEqual(['/assets/real.png']);
  });

  it('lets an unterminated block comment consume through EOF', () => {
    const source = [
      '/* the comment never closes',
      '.hidden { background: url(/assets/hidden.png); }',
    ].join('\n');

    expect(valuesIn(source)).toEqual([]);
  });

  it('recognizes case-insensitive URL functions without matching identifiers', () => {
    const source = [
      '.a { background: URL(/assets/a.png); }',
      '.b { background: Url("/assets/b.png"); }',
      '.c { background: uRl(/assets/c.png); }',
      '.ignored { value: myURL(/assets/hidden.png); }',
    ].join('\n');
    const { urls } = tokenizeStylesheetUrls(source);

    expect(urls.map(({ value }) => value)).toEqual([
      '/assets/a.png',
      '/assets/b.png',
      '/assets/c.png',
    ]);
    expect(urls.map(({ match }) => match)).toEqual([
      'URL(/assets/a.png)',
      'Url("/assets/b.png")',
      'uRl(/assets/c.png)',
    ]);
  });

  it('computes the offset-preserving comment mask lazily', () => {
    const source = [
      '/* url(/assets/hidden.png) */',
      '.real { background: url(/assets/real.png); }',
    ].join('\n');
    const result = tokenizeStylesheetUrls(source);
    const descriptor = Object.getOwnPropertyDescriptor(
      result,
      'sourceWithoutComments',
    );

    expect(descriptor).toMatchObject({
      enumerable: true,
      get: expect.any(Function),
    });
    expect(result.sourceWithoutComments).toHaveLength(source.length);
    expect(result.sourceWithoutComments.split('\n')[0].trim()).toBe('');
    expect(result.sourceWithoutComments.split('\n')[1]).toBe(
      '.real { background: url(/assets/real.png); }',
    );
  });

  it.each([
    ['an EOF suffix', ''],
    ['a quote-terminated suffix', SINGLE_QUOTE],
  ])(
    'scans repeated unterminated URL functions before %s within a fixed time budget',
    (_label, suffix) => {
      tokenizeStylesheetUrls('url(/assets/warmup.png)');
      const source = `${'url('.repeat(PATHOLOGICAL_URL_COUNT)}${suffix}`;
      const started = performance.now();
      const { urls } = tokenizeStylesheetUrls(source);
      const elapsed = performance.now() - started;

      expect(urls).toEqual([]);
      expect(elapsed).toBeLessThan(PERFORMANCE_BUDGET_MS);
    },
    15_000,
  );
});

describe('replaceStylesheetUrlTokens', () => {
  it('rewrites a URL after a bad string without touching the damaged line', () => {
    const source = [
      '.bad { content: "unfinished',
      '.real { background: URL(/assets/real.png); }',
    ].join('\n');

    expect(
      replaceStylesheetUrlTokens(source, ({ value }) => `url(${value}?v=2)`),
    ).toBe(
      [
        '.bad { content: "unfinished',
        '.real { background: url(/assets/real.png?v=2); }',
      ].join('\n'),
    );
  });
});
