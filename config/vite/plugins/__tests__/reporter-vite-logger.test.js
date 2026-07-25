/**
 * @file Tests for the Vite logger wrapper and unresolved CSS asset reporting.
 */

import { createDiagnosticsCollector } from '../reporter/diagnostics.js';
import {
  createReporterLogger,
  parseUnresolvedAsset,
} from '../reporter/vite-logger.js';
import { renderSummary } from '../reporter/render.js';
import { createStyler } from '../reporter/format.js';

const plain = createStyler(false);

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

describe('unresolved asset rendering', () => {
  /**
   * Collect a snapshot containing the given urls.
   *
   * @param {number} count - How many urls to record.
   * @returns {object} Diagnostics snapshot.
   */
  const snapshotWithAssets = (count) => {
    const collector = createDiagnosticsCollector();
    for (let index = 0; index < count; index += 1) {
      collector.recordUnresolvedAsset({ url: `../images/a${index}.png` });
    }
    return collector.snapshot();
  };

  it('groups the notices into one block with an explanation', () => {
    const output = renderSummary({
      snapshot: snapshotWithAssets(3),
      durationMs: 100,
      projectDir: '/project',
      styler: plain,
    }).join('\n');

    expect(output).toContain('! 3 unresolved css urls · emitted unchanged');
    expect(output).toContain('../images/a0.png');
    expect(output).toContain(
      'these must resolve from the built css, not the source file',
    );
    // The raw Vite phrasing never reaches the user.
    expect(output).not.toContain('resolved at runtime');
  });

  it('names the referencing stylesheet when Vite knows it', () => {
    const collector = createDiagnosticsCollector();
    collector.recordUnresolvedAsset({
      url: '../images/bg.png',
      importer: '/project/src/components/base/base.scss',
    });

    const output = renderSummary({
      snapshot: collector.snapshot(),
      durationMs: 10,
      projectDir: '/project',
      styler: plain,
    }).join('\n');

    expect(output).toContain(
      '../images/bg.png  in src/components/base/base.scss',
    );
  });

  it('shows a typical run in full without collapsing', () => {
    // Three images spelled two ways each is the common real-world shape.
    const output = renderSummary({
      snapshot: snapshotWithAssets(6),
      durationMs: 10,
      projectDir: '/project',
      styler: plain,
    }).join('\n');

    expect(output).toContain('! 6 unresolved css urls');
    expect(output).not.toContain('more');
  });

  it('caps a runaway list and reports the remainder', () => {
    const output = renderSummary({
      snapshot: snapshotWithAssets(12),
      durationMs: 10,
      projectDir: '/project',
      styler: plain,
    }).join('\n');

    expect(output).toContain('! 12 unresolved css urls');
    expect(output).toContain('+4 more');
  });

  it('says nothing when every url resolved', () => {
    const output = renderSummary({
      snapshot: createDiagnosticsCollector().snapshot(),
      durationMs: 10,
      projectDir: '/project',
      styler: plain,
    }).join('\n');

    expect(output).not.toContain('unresolved css');
  });
});
