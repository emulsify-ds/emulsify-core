/**
 * @file Tests for the Vite logger wrapper and its capture of asset notices.
 *
 * Rendering of the captured notices is covered in reporter-asset-resolver.test.js.
 */

import { createDiagnosticsCollector } from '../reporter/diagnostics.js';
import {
  compactDevServerError,
  createDevServerLogger,
  createReporterLogger,
  parseUnresolvedAsset,
} from '../reporter/vite-logger.js';

/**
 * Build a stub Vite logger that records what reaches it.
 *
 * @returns {object} Logger with captured calls.
 */
function createBaseLogger() {
  return {
    hasWarned: false,
    info: jest.fn(),
    warn: jest.fn(),
    warnOnce: jest.fn(),
    error: jest.fn(),
    clearScreen: jest.fn(),
    hasErrorLogged: jest.fn(() => false),
  };
}

// Built rather than written literally so the fixture keeps the apostrophe that
// Vite's real message contains without tripping the single-quote lint rule.
const APOSTROPHE = String.fromCharCode(39);

/**
 * Build the notice Vite emits from the `vite:css` url replacer.
 *
 * @param {string} url - Unresolved url.
 * @param {string} importer - Referencing stylesheet.
 * @returns {string} Notice text, with the leading newline Vite includes.
 */
const notice = (url, importer) =>
  `\n${url} referenced in ${importer} didn${APOSTROPHE}t resolve at build time,` +
  ' it will remain unchanged to be resolved at runtime';

const NOTICE = notice(
  '../images/bg-lines.png',
  'src/components/base/base.scss',
);

describe('unresolved asset parsing', () => {
  it('extracts the url and the referencing stylesheet', () => {
    expect(parseUnresolvedAsset(NOTICE)).toEqual({
      url: '../images/bg-lines.png',
      importer: 'src/components/base/base.scss',
    });
  });

  it('drops the importer when Vite reports the url as its own importer', () => {
    expect(
      parseUnresolvedAsset(notice('../images/plus.png', '../images/plus.png')),
    ).toEqual({ url: '../images/plus.png', importer: undefined });
  });

  it('tolerates ansi styling around the message', () => {
    const styled = `[33m${NOTICE.trim()}[39m`;
    expect(parseUnresolvedAsset(styled)?.url).toBe('../images/bg-lines.png');
  });

  it('ignores unrelated messages', () => {
    expect(parseUnresolvedAsset('some other warning')).toBeUndefined();
    expect(parseUnresolvedAsset(undefined)).toBeUndefined();
    expect(parseUnresolvedAsset(42)).toBeUndefined();
  });
});

describe('reporter logger', () => {
  it('captures unresolved asset notices instead of printing them', () => {
    const collector = createDiagnosticsCollector();
    const base = createBaseLogger();
    const logger = createReporterLogger(collector, base);

    logger.warnOnce(NOTICE);

    expect(base.warnOnce).not.toHaveBeenCalled();
    expect(collector.snapshot().unresolvedAssets).toEqual([
      {
        url: '../images/bg-lines.png',
        importer: 'src/components/base/base.scss',
        count: 1,
      },
    ]);
  });

  it('passes every other message straight through', () => {
    const collector = createDiagnosticsCollector();
    const base = createBaseLogger();
    const logger = createReporterLogger(collector, base);

    logger.warn('a real warning');
    logger.info('building');
    logger.error('boom');
    logger.clearScreen('error');
    logger.hasErrorLogged(new Error('x'));

    expect(base.warn).toHaveBeenCalledWith('a real warning', undefined);
    expect(base.info).toHaveBeenCalledWith('building', undefined);
    expect(base.error).toHaveBeenCalledWith('boom', undefined);
    expect(base.clearScreen).toHaveBeenCalledWith('error');
    expect(base.hasErrorLogged).toHaveBeenCalled();
    expect(collector.snapshot().hasProblems).toBe(false);
  });

  it('delegates hasWarned rather than freezing a copy', () => {
    const base = createBaseLogger();
    const logger = createReporterLogger(createDiagnosticsCollector(), base);

    expect(logger.hasWarned).toBe(false);
    base.hasWarned = true;
    expect(logger.hasWarned).toBe(true);

    logger.hasWarned = false;
    expect(base.hasWarned).toBe(false);
  });

  it('counts repeats of the same url', () => {
    const collector = createDiagnosticsCollector();
    const logger = createReporterLogger(collector, createBaseLogger());

    logger.warnOnce(NOTICE);
    logger.warn(NOTICE);

    const [asset] = collector.snapshot().unresolvedAssets;
    expect(asset.count).toBe(2);
  });

  it('keeps differently spelled urls apart', () => {
    const collector = createDiagnosticsCollector();
    const logger = createReporterLogger(collector, createBaseLogger());

    logger.warnOnce(notice('../images/plus.png', 'a.scss'));
    logger.warnOnce(notice('images/plus.png', 'b.scss'));

    // Each spelling is a separate edit for the author to make.
    expect(collector.snapshot().unresolvedAssets).toHaveLength(2);
  });
});

// Shape Vite's dev server actually prints for a Sass syntax error: the
// message, the excerpt, `Plugin:`/`File:`, then `err.stack` — which repeats the
// message and excerpt before listing frames inside the compiler bundle.
const QUOTE = String.fromCharCode(39);
const EXCERPT = `@use ${QUOTE}../../base/global/colors/color-vars${QUOTE} as *`;
const SASS_DEV_SERVER_ERROR = [
  'Internal server error: [sass] expected ";".',
  '  ╷',
  `5 │ ${EXCERPT}`,
  '  │                                                ^',
  '  ╵',
  '  src/tab-refresh.scss 5:48  root stylesheet',
  '  Plugin: vite:css',
  '  File: /project/src/tab-refresh.scss:5:48',
  '  [sass] expected ";".',
  '    ╷',
  `  5 │ ${EXCERPT}`,
  '    │                                                ^',
  '    ╵',
  '    src/tab-refresh.scss 5:48  root stylesheet',
  '      at Object.wrapException (/project/node_modules/sass/sass.dart.js:2310:47)',
  '      at SpanScanner.error$3$length$position (/project/node_modules/sass/sass.dart.js:87501:15)',
  '      at async loadAndTransform (/project/node_modules/vite/dist/node/chunks/node.js:20619:26)',
].join('\n');

describe('compactDevServerError', () => {
  it('cuts everything after the File line', () => {
    expect(compactDevServerError(SASS_DEV_SERVER_ERROR).split('\n')).toEqual(
      SASS_DEV_SERVER_ERROR.split('\n').slice(0, 8),
    );
  });

  it('falls back to the first stack frame when there is no File line', () => {
    const message = [
      'Internal server error: boom',
      '  something useful',
      '    at Object.thing (/x/y.js:1:1)',
      '    at other (/x/z.js:2:2)',
    ].join('\n');

    expect(compactDevServerError(message)).toBe(
      'Internal server error: boom\n  something useful',
    );
  });

  it('leaves a message with no stack alone', () => {
    // Truncating on a guess would be worse than printing one extra line.
    const message = 'Internal server error: something unfamiliar';

    expect(compactDevServerError(message)).toBe(message);
  });

  it('leaves a message that is nothing but frames alone', () => {
    // Cutting at index 0 would print nothing at all.
    const message = '    at a (/x.js:1:1)\n    at b (/y.js:2:2)';

    expect(compactDevServerError(message)).toBe(message);
  });
});

describe('storybook dev server logger', () => {
  // Vite colors the notice, so the fixture carries escapes the filter has to
  // look past. Built from the escape character to keep it out of the source.
  const ESC = String.fromCharCode(27);
  const green = (text) => `${ESC}[32m${text}${ESC}[39m`;
  const dim = (text) => `${ESC}[2m${text}${ESC}[22m`;
  const hmr = (files) => green('hmr update ') + dim(files);

  it('drops hmr notices at the default level', () => {
    // The watch build rewrites all of dist/ every cycle and Storybook imports
    // its css from dist/, so one saved stylesheet lands as several of these.
    const base = createBaseLogger();
    const logger = createDevServerLogger({ baseLogger: base, verbose: false });

    logger.info(hmr('/dist/global/layout/layout.css'));
    logger.info(
      hmr('/@id/__x00__virtual:/@storybook/builder-vite/vite-app.js'),
    );

    expect(base.info).not.toHaveBeenCalled();
  });

  it('passes every other message through untouched', () => {
    const base = createBaseLogger();
    const logger = createDevServerLogger({ baseLogger: base, verbose: false });

    logger.info('optimized dependencies changed, reloading');

    expect(base.info).toHaveBeenCalledWith(
      'optimized dependencies changed, reloading',
      undefined,
    );
  });

  it('keeps hmr notices when more output was requested', () => {
    // Filtering output away from someone who asked for more of it is backwards.
    const base = createBaseLogger();
    const logger = createDevServerLogger({ baseLogger: base, verbose: true });

    logger.info(hmr('/dist/global/layout/layout.css'));

    expect(base.info).toHaveBeenCalled();
  });

  it('never filters warnings or errors', () => {
    const base = createBaseLogger();
    const logger = createDevServerLogger({ baseLogger: base, verbose: false });

    logger.warn('hmr update something went wrong');
    logger.error('hmr update also broken');

    expect(base.warn).toHaveBeenCalled();
    expect(base.error).toHaveBeenCalled();
  });

  it('compacts a transform failure down to the part that names it', () => {
    const base = createBaseLogger();
    const logger = createDevServerLogger({ baseLogger: base, verbose: false });

    logger.error(SASS_DEV_SERVER_ERROR);

    const printed = base.error.mock.calls[0][0];
    expect(printed).toContain('expected ";".');
    expect(printed).toContain('tab-refresh.scss 5:48');
    expect(printed).toContain('File: /project/src/tab-refresh.scss:5:48');
    expect(printed).not.toContain('sass.dart.js');
    expect(printed.split('\n')).toHaveLength(8);
  });

  it('keeps the whole dump when more output was requested', () => {
    const base = createBaseLogger();
    const logger = createDevServerLogger({ baseLogger: base, verbose: true });

    logger.error(SASS_DEV_SERVER_ERROR);

    expect(base.error).toHaveBeenCalledWith(SASS_DEV_SERVER_ERROR, undefined);
  });

  it('keeps a message that merely mentions hmr in prose', () => {
    const base = createBaseLogger();
    const logger = createDevServerLogger({ baseLogger: base, verbose: false });

    logger.info('hmr updated nothing; full reload required');

    expect(base.info).toHaveBeenCalled();
  });

  it('proxies hasWarned in both directions', () => {
    // Vite reads this back after logging, so a copy would freeze it.
    const base = createBaseLogger();
    const logger = createDevServerLogger({ baseLogger: base, verbose: false });

    base.hasWarned = true;
    expect(logger.hasWarned).toBe(true);

    logger.hasWarned = false;
    expect(base.hasWarned).toBe(false);
  });
});
