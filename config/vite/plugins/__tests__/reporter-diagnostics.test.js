/**
 * @file Tests for develop reporter diagnostic collection and the Sass logger.
 */

import { pathToFileURL } from 'node:url';

import { createDiagnosticsCollector } from '../reporter/diagnostics.js';
import {
  DEPRECATION_GUIDE,
  condenseMessage,
  createSassLogger,
  createSassOptions,
  deprecationFix,
  deprecationMigrator,
  isRepetitionNotice,
  spanLineNumber,
  spanUrlToPath,
} from '../reporter/sass-logger.js';

/**
 * Build a Sass-shaped warning options object.
 *
 * @param {{id: string, file?: string, line?: number}} options - Warning inputs.
 * @returns {object} Sass logger options.
 */
const deprecationOptions = ({
  id,
  file = '/project/src/_vars.scss',
  line = 29,
}) => ({
  deprecation: true,
  deprecationType: { id },
  span: { url: pathToFileURL(file), start: { line, column: 0 } },
});

describe('diagnostics collector', () => {
  it('collapses repeated deprecations into one bucket with an occurrence count', () => {
    const collector = createDiagnosticsCollector();

    for (let index = 0; index < 20; index += 1) {
      collector.recordDeprecation({
        id: 'slash-div',
        file: '/project/src/_vars.scss',
        line: 30,
      });
    }

    const snapshot = collector.snapshot();

    expect(snapshot.deprecations).toHaveLength(1);
    expect(snapshot.deprecations[0]).toMatchObject({
      id: 'slash-div',
      occurrences: 20,
    });
    expect(snapshot.deprecations[0].locations).toHaveLength(1);
    expect(snapshot.deprecationTotal).toBe(20);
    expect(snapshot.deprecationFileCount).toBe(1);
  });

  it('tracks distinct locations within a single deprecation id', () => {
    const collector = createDiagnosticsCollector();

    collector.recordDeprecation({ id: 'slash-div', file: '/a.scss', line: 30 });
    collector.recordDeprecation({ id: 'slash-div', file: '/a.scss', line: 31 });
    collector.recordDeprecation({ id: 'slash-div', file: '/b.scss', line: 30 });
    collector.recordDeprecation({ id: 'slash-div', file: '/b.scss', line: 30 });

    const [bucket] = collector.snapshot().deprecations;

    expect(bucket.occurrences).toBe(4);
    expect(bucket.locations).toHaveLength(3);
    // Locations sort by descending count, so the doubled one leads.
    expect(bucket.locations[0]).toMatchObject({ file: '/b.scss', count: 2 });
    expect(collector.snapshot().deprecationFileCount).toBe(2);
  });

  it('orders deprecation buckets by descending occurrence count', () => {
    const collector = createDiagnosticsCollector();

    collector.recordDeprecation({ id: 'color-functions', file: '/a.scss' });
    for (let index = 0; index < 5; index += 1) {
      collector.recordDeprecation({ id: 'global-builtin', file: '/b.scss' });
    }

    expect(collector.snapshot().deprecations.map((entry) => entry.id)).toEqual([
      'global-builtin',
      'color-functions',
    ]);
  });

  it('falls back to an unknown id when Sass omits the deprecation type', () => {
    const collector = createDiagnosticsCollector();
    collector.recordDeprecation({ file: '/a.scss' });

    expect(collector.snapshot().deprecations[0].id).toBe('unknown');
  });

  it('deduplicates identical errors reported through more than one channel', () => {
    const collector = createDiagnosticsCollector();
    const error = {
      // Built rather than written literally so the fixture keeps the
      // apostrophe real Sass output contains without tripping the lint rule.
      message: `Can${String.fromCharCode(39)}t find stylesheet to import.`,
      file: '/project/src/templates.scss',
      line: 1,
    };

    collector.recordError(error);
    collector.recordError({ ...error });

    const snapshot = collector.snapshot();
    expect(snapshot.errors).toHaveLength(1);
    expect(snapshot.errors[0].count).toBe(2);
    expect(snapshot.hasProblems).toBe(true);
  });

  it('separates errors that differ only by location', () => {
    const collector = createDiagnosticsCollector();

    collector.recordError({ message: 'boom', file: '/a.scss', line: 1 });
    collector.recordError({ message: 'boom', file: '/a.scss', line: 2 });

    expect(collector.snapshot().errors).toHaveLength(2);
  });

  it('projects a per-file worklist collapsing each kind once', () => {
    const collector = createDiagnosticsCollector();

    for (const line of [30, 31]) {
      for (let index = 0; index < 3; index += 1) {
        collector.recordDeprecation({ id: 'slash-div', file: '/a.scss', line });
      }
    }
    collector.recordDeprecation({
      id: 'global-builtin',
      file: '/a.scss',
      line: 12,
    });
    collector.recordDeprecation({ id: 'slash-div', file: '/b.scss', line: 4 });

    const [first, second] = collector.snapshot().deprecationsByFile;

    // Files sort by total occurrences, so the heavier file leads.
    expect(first.file).toBe('/a.scss');
    expect(first.occurrences).toBe(7);
    expect(first.entries).toHaveLength(2);
    expect(first.entries[0]).toEqual({
      id: 'slash-div',
      count: 6,
      lines: [30, 31],
    });
    expect(first.entries[1]).toEqual({
      id: 'global-builtin',
      count: 1,
      lines: [12],
    });
    expect(second.file).toBe('/b.scss');
  });

  it('keeps locationless deprecations out of the worklist but in the totals', () => {
    const collector = createDiagnosticsCollector();

    collector.recordDeprecation({ id: 'import' });
    collector.recordDeprecation({ id: 'slash-div', file: '/a.scss', line: 1 });

    const snapshot = collector.snapshot();
    expect(snapshot.deprecationTotal).toBe(2);
    expect(snapshot.deprecationsByFile).toHaveLength(1);
    expect(snapshot.deprecationsByFile[0].file).toBe('/a.scss');
  });

  it('sorts affected lines numerically rather than lexically', () => {
    const collector = createDiagnosticsCollector();

    for (const line of [100, 9, 30]) {
      collector.recordDeprecation({ id: 'slash-div', file: '/a.scss', line });
    }

    expect(collector.snapshot().deprecationsByFile[0].entries[0].lines).toEqual(
      [9, 30, 100],
    );
  });

  it('reports a clean snapshot with no problems', () => {
    expect(createDiagnosticsCollector().snapshot()).toMatchObject({
      deprecations: [],
      deprecationsByFile: [],
      warnings: [],
      errors: [],
      deprecationTotal: 0,
      deprecationFileCount: 0,
      hasProblems: false,
    });
  });

  it('clears all state on reset so cycles do not accumulate', () => {
    const collector = createDiagnosticsCollector();

    collector.recordDeprecation({ id: 'slash-div', file: '/a.scss' });
    collector.recordError({ message: 'boom' });
    collector.recordWarning({ message: 'careful' });
    collector.reset();

    expect(collector.snapshot().hasProblems).toBe(false);
  });
});

describe('sass logger', () => {
  it('routes deprecations into the collector without printing', () => {
    const collector = createDiagnosticsCollector();
    const logger = createSassLogger(collector);

    logger.warn(
      'Using / for division outside of calc() is deprecated.',
      deprecationOptions({ id: 'slash-div', line: 29 }),
    );

    const [bucket] = collector.snapshot().deprecations;
    expect(bucket.id).toBe('slash-div');
    // Sass reports zero-based lines; the collector stores them one-based.
    expect(bucket.locations[0].line).toBe(30);
  });

  it('records non-deprecation warnings with a condensed message', () => {
    const collector = createDiagnosticsCollector();
    const logger = createSassLogger(collector);

    logger.warn('Something looks wrong\n  ╷\n1 │ $a: 1;\n  ╵', {
      span: { url: pathToFileURL('/project/src/a.scss'), start: { line: 0 } },
    });

    const snapshot = collector.snapshot();
    expect(snapshot.deprecations).toHaveLength(0);
    expect(snapshot.warnings[0]).toMatchObject({
      message: 'Something looks wrong',
      line: 1,
    });
  });

  it('survives warnings that carry no span', () => {
    const collector = createDiagnosticsCollector();
    const logger = createSassLogger(collector);

    logger.warn('No location here', {
      deprecation: true,
      deprecationType: { id: 'import' },
    });

    expect(collector.snapshot().deprecations[0].locations[0]).toMatchObject({
      file: undefined,
      line: undefined,
    });
  });

  it('forwards to a passthrough when one is supplied', () => {
    const collector = createDiagnosticsCollector();
    const passthrough = jest.fn();
    const logger = createSassLogger(collector, { passthrough });

    logger.warn('warned', deprecationOptions({ id: 'slash-div' }));

    expect(passthrough).toHaveBeenCalledTimes(1);
  });

  it('discards @debug output entirely', () => {
    const collector = createDiagnosticsCollector();
    const logger = createSassLogger(collector);

    logger.debug('inspecting', {});

    expect(collector.snapshot().hasProblems).toBe(false);
  });

  it('drops Sass truncation notices instead of recording locationless warnings', () => {
    const collector = createDiagnosticsCollector();
    const logger = createSassLogger(collector);

    // Emitted by Sass with no span once it stops reporting a repeated
    // deprecation. Recording it produced the "<unknown> (×2)" summary rows.
    logger.warn(
      '4 repetitive deprecation warnings omitted.\nRun in verbose mode to see all warnings.',
      {},
    );
    logger.warn('20 repetitive deprecation warnings omitted.', {});

    expect(collector.snapshot().warnings).toHaveLength(0);
    expect(collector.snapshot().hasProblems).toBe(false);
  });

  it('still records genuine warnings that merely lack a span', () => {
    const collector = createDiagnosticsCollector();
    const logger = createSassLogger(collector);

    logger.warn('something real happened', {});

    expect(collector.snapshot().warnings[0]).toMatchObject({
      message: 'something real happened',
      file: undefined,
    });
  });
});

describe('repetition notice detection', () => {
  it('matches the Sass truncation notice in its known forms', () => {
    expect(
      isRepetitionNotice('4 repetitive deprecation warnings omitted.'),
    ).toBe(true);
    expect(
      isRepetitionNotice('1 repetitive deprecation warning omitted.'),
    ).toBe(true);
    expect(
      isRepetitionNotice(
        '  20 Repetitive Deprecation Warnings Omitted.\nRun in verbose mode.',
      ),
    ).toBe(true);
  });

  it('does not match real warnings', () => {
    expect(isRepetitionNotice('lighten() is deprecated.')).toBe(false);
    expect(isRepetitionNotice('repetitive deprecation warnings omitted.')).toBe(
      false,
    );
    expect(isRepetitionNotice(undefined)).toBe(false);
  });
});

describe('deprecation guide', () => {
  it('translates the deprecations Emulsify projects actually hit', () => {
    expect(deprecationFix('slash-div')).toBe('$a/$b → math.div($a, $b)');
    expect(deprecationFix('global-builtin')).toBe('map-get() → map.get()');
    expect(deprecationFix('color-functions')).toBe(
      'lighten()/darken() → color.adjust()',
    );
    expect(deprecationFix('unrecognized-id')).toBeUndefined();
  });

  it('maps only to migrations the sass-migrator CLI actually ships', () => {
    // The migrator provides exactly these five migrations. Naming anything
    // else would print a command that fails.
    const supported = new Set([
      'color',
      'division',
      'module',
      'namespace',
      'if',
    ]);

    for (const [id, entry] of Object.entries(DEPRECATION_GUIDE)) {
      expect(typeof entry.fix).toBe('string');
      if (entry.migrator) {
        expect(supported.has(entry.migrator)).toBe(true);
      }
      expect(deprecationFix(id)).toBe(entry.fix);
    }

    expect(deprecationMigrator('slash-div')).toBe('division');
    expect(deprecationMigrator('global-builtin')).toBe('module');
    // Fixed by hand; there is no migration for it.
    expect(deprecationMigrator('mixed-decls')).toBeUndefined();
  });
});

describe('sass preprocessor options', () => {
  it('pairs the quiet logger with verbose so counts are complete', () => {
    const collector = createDiagnosticsCollector();
    const options = createSassOptions(collector);

    // Without verbose, Sass caps each deprecation at five reported instances
    // and the reporter would undercount by everything it suppressed.
    expect(options.verbose).toBe(true);
    expect(typeof options.logger.warn).toBe('function');
    expect(typeof options.logger.debug).toBe('function');

    options.logger.warn('boom', {});
    expect(collector.snapshot().warnings).toHaveLength(1);
  });
});

describe('sass span helpers', () => {
  it('converts file URLs to filesystem paths', () => {
    const url = pathToFileURL('/project/src/a.scss');
    expect(spanUrlToPath(url)).toBe('/project/src/a.scss');
    expect(spanUrlToPath(url.href)).toBe('/project/src/a.scss');
  });

  it('passes non-file URLs through unchanged', () => {
    expect(spanUrlToPath('custom:importer/a.scss')).toBe(
      'custom:importer/a.scss',
    );
  });

  it('returns undefined for a missing URL', () => {
    expect(spanUrlToPath(undefined)).toBeUndefined();
    expect(spanUrlToPath('')).toBeUndefined();
  });

  it('converts zero-based span lines to one-based', () => {
    expect(spanLineNumber({ start: { line: 0 } })).toBe(1);
    expect(spanLineNumber({ start: {} })).toBeUndefined();
    expect(spanLineNumber(undefined)).toBeUndefined();
  });

  it('condenses multi-line messages to the first line', () => {
    expect(condenseMessage('first\nsecond')).toBe('first');
    expect(condenseMessage('  padded  ')).toBe('padded');
    expect(condenseMessage(undefined)).toBeUndefined();
  });
});
