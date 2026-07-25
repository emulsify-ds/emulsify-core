/**
 * @file Tests for the Vite logger wrapper and its capture of asset notices.
 *
 * Rendering of the captured notices is covered in reporter-asset-resolver.test.js.
 */

import { createDiagnosticsCollector } from '../reporter/diagnostics.js';
import {
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
