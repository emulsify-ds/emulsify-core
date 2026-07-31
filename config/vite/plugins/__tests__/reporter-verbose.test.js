/**
 * @file Tests for the reporter's detailed (verbose) mode.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDiagnosticsCollector } from '../reporter/diagnostics.js';
import { createStyler, formatPreciseBytes } from '../reporter/format.js';
import { developReporterPlugin } from '../reporter/index.js';
import { renderRebuild, renderSummary } from '../reporter/render.js';
import {
  VERBOSITY,
  isDetailed,
  isVerbose,
  resolveVerbosity,
} from '../reporter/verbosity.js';
import {
  buildInputFileRows,
  buildOutputFileRows,
  diffFingerprints,
  fingerprintBundle,
} from '../reporter/source-roots.js';

const plain = createStyler(false);

const emptySnapshot = () => createDiagnosticsCollector().snapshot();

describe('verbosity resolution', () => {
  it('defaults to quiet', () => {
    expect(resolveVerbosity({})).toBe(VERBOSITY.quiet);
    expect(isVerbose({})).toBe(false);
    expect(isDetailed({})).toBe(false);
  });

  it('keeps EMULSIFY_VERBOSE=1 meaning raw passthrough', () => {
    // This is the published behavior, and a detailed mode that quietly
    // reinterpreted the existing value would change what shipped docs promise.
    expect(resolveVerbosity({ EMULSIFY_VERBOSE: '1' })).toBe(VERBOSITY.raw);
    expect(isVerbose({ EMULSIFY_VERBOSE: '1' })).toBe(true);
    expect(isDetailed({ EMULSIFY_VERBOSE: '1' })).toBe(false);
  });

  it('treats any other truthy value as raw', () => {
    expect(resolveVerbosity({ EMULSIFY_VERBOSE: 'true' })).toBe(VERBOSITY.raw);
    expect(resolveVerbosity({ EMULSIFY_VERBOSE: 'yes' })).toBe(VERBOSITY.raw);
  });

  it('reads EMULSIFY_VERBOSE=2 as the detailed reporter', () => {
    expect(resolveVerbosity({ EMULSIFY_VERBOSE: '2' })).toBe(
      VERBOSITY.detailed,
    );
    expect(isDetailed({ EMULSIFY_VERBOSE: '2' })).toBe(true);
    expect(isVerbose({ EMULSIFY_VERBOSE: '2' })).toBe(false);
  });

  it('honors EMULSIFY_VERBOSE=0 as off', () => {
    expect(resolveVerbosity({ EMULSIFY_VERBOSE: '0' })).toBe(VERBOSITY.quiet);
  });

  it('detects npm run develop --verbose through the npm log level', () => {
    // npm claims `--verbose` as an alias for `--loglevel verbose` and never
    // passes it to the script, but it does export the level, and that inherits
    // through `concurrently` into the vite child.
    expect(resolveVerbosity({ npm_config_loglevel: 'verbose' })).toBe(
      VERBOSITY.detailed,
    );
    expect(resolveVerbosity({ npm_config_loglevel: 'silly' })).toBe(
      VERBOSITY.detailed,
    );
  });

  it('ignores npm log levels that did not ask for more output', () => {
    for (const level of ['warn', 'info', 'error', 'silent', 'notice']) {
      expect(resolveVerbosity({ npm_config_loglevel: level })).toBe(
        VERBOSITY.quiet,
      );
    }
  });

  it('lets the environment variable override a raised npm log level', () => {
    // A project whose .npmrc raises loglevel permanently still needs a way to
    // pin the reporter back down.
    expect(
      resolveVerbosity({
        EMULSIFY_VERBOSE: '0',
        npm_config_loglevel: 'verbose',
      }),
    ).toBe(VERBOSITY.quiet);
  });
});

describe('input file listing', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'emulsify-verbose-'));

  mkdirSync(join(fixture, 'src'), { recursive: true });
  writeFileSync(join(fixture, 'src/a.scss'), 'a'.repeat(2048));
  writeFileSync(join(fixture, 'src/b.scss'), 'b'.repeat(1024));

  it('lists every entry with the size of its source', () => {
    const rows = buildInputFileRows({
      entries: {
        a: join(fixture, 'src/a.scss'),
        b: join(fixture, 'src/b.scss'),
      },
      projectDir: fixture,
    });

    expect(rows).toEqual([
      { path: 'src/a.scss', bytes: 2048 },
      { path: 'src/b.scss', bytes: 1024 },
    ]);
  });

  it('orders by path rather than by size', () => {
    // A full input listing is read to check that the tree was picked up, and a
    // tree is scanned in path order. Size ranking belongs to the output table.
    const rows = buildInputFileRows({
      entries: {
        big: join(fixture, 'src/a.scss'),
        small: join(fixture, 'src/b.scss'),
      },
      projectDir: fixture,
    });

    expect(rows.map((row) => row.path)).toEqual(['src/a.scss', 'src/b.scss']);
  });

  it('still lists an entry the filesystem does not have', () => {
    // A path the build resolved but that is not on disk is exactly what someone
    // reads a verbose listing to find, so the row survives without a size.
    const rows = buildInputFileRows({
      entries: { gone: join(fixture, 'src/missing.scss') },
      projectDir: fixture,
    });

    expect(rows).toEqual([{ path: 'src/missing.scss', bytes: undefined }]);
  });

  it('returns nothing when there are no entries', () => {
    expect(buildInputFileRows()).toEqual([]);
    expect(buildInputFileRows({ entries: {} })).toEqual([]);
  });
});

describe('output file listing', () => {
  const bundle = {
    'small.css': { type: 'asset', source: 'a'.repeat(1024) },
    'big.css': { type: 'asset', source: 'b'.repeat(8192) },
    'font.woff2': { type: 'asset', source: new Uint8Array(4096) },
    'bundle.js.map': { type: 'asset', source: 'c'.repeat(65536) },
  };

  it('orders by size descending so the heaviest file leads', () => {
    const rows = buildOutputFileRows(bundle);

    expect(rows.map((row) => row.fileName)).toEqual([
      'bundle.js.map',
      'big.css',
      'font.woff2',
      'small.css',
    ]);
  });

  it('measures compressed size only where the number means something', () => {
    const rows = buildOutputFileRows(bundle);
    const byName = Object.fromEntries(
      rows.map((row) => [row.fileName, row.gzipBytes]),
    );

    expect(typeof byName['big.css']).toBe('number');
    // Fonts are already compressed, and a sourcemap is a diagnostic artifact
    // nobody ships — gzipping either buys a misleading number for real time.
    expect(byName['font.woff2']).toBeUndefined();
    expect(byName['bundle.js.map']).toBeUndefined();
  });

  it('skips gzip entirely when asked', () => {
    const rows = buildOutputFileRows(bundle, { gzip: false });

    for (const row of rows) expect(row.gzipBytes).toBeUndefined();
  });

  it('returns nothing for an absent bundle', () => {
    expect(buildOutputFileRows()).toEqual([]);
    expect(buildOutputFileRows({})).toEqual([]);
  });
});

describe('output change detection', () => {
  it('reports only the files whose contents differ', () => {
    // Rollup regenerates the whole bundle every cycle, so "what was written" is
    // always everything. Content hashes are what make the question answerable.
    const before = fingerprintBundle({
      'a.css': { source: 'one' },
      'b.css': { source: 'two' },
    });
    const after = fingerprintBundle({
      'a.css': { source: 'one' },
      'b.css': { source: 'changed' },
    });

    expect(diffFingerprints(before, after)).toEqual({
      changed: ['b.css'],
      removed: [],
    });
  });

  it('reports a file that stopped being written', () => {
    const before = fingerprintBundle({
      'a.css': { source: 'one' },
      'gone.css': { source: 'two' },
    });
    const after = fingerprintBundle({ 'a.css': { source: 'one' } });

    expect(diffFingerprints(before, after)).toEqual({
      changed: [],
      removed: ['gone.css'],
    });
  });

  it('treats every file in a first bundle as changed', () => {
    const after = fingerprintBundle({ 'a.css': { source: 'one' } });

    expect(diffFingerprints(new Map(), after).changed).toEqual(['a.css']);
  });

  it('sees a rewrite that produced identical bytes as no change', () => {
    const bundle = { 'a.css': { source: 'same' } };

    expect(
      diffFingerprints(fingerprintBundle(bundle), fingerprintBundle(bundle)),
    ).toEqual({ changed: [], removed: [] });
  });
});

describe('table size formatting', () => {
  it('keeps enough precision for a column to be worth comparing', () => {
    // Rounded to whole kilobytes these two collapse to `6 kB` and `3 kB`, which
    // defeats the point of putting them in a column.
    expect(formatPreciseBytes(5660)).toBe('5.53 kB');
    expect(formatPreciseBytes(3010)).toBe('2.94 kB');
    expect(formatPreciseBytes(260)).toBe('0.25 kB');
    expect(formatPreciseBytes(-1)).toBe('0.00 kB');
  });
});

describe('detailed summary rendering', () => {
  const summaryOf = (overrides = {}) =>
    renderSummary({
      snapshot: emptySnapshot(),
      durationMs: 1000,
      inputRows: [{ name: 'components', path: 'src/', count: 2 }],
      platform: 'drupal',
      outDir: 'dist/',
      unicode: true,
      styler: plain,
      ...overrides,
    }).join('\n');

  it('adds no listings when nothing was collected', () => {
    const output = summaryOf();

    expect(output).not.toContain('input files');
    expect(output).not.toContain('output files');
  });

  it('itemizes the inputs and outputs under their own headings', () => {
    const output = summaryOf({
      inputFiles: [{ path: 'src/a.scss', bytes: 2048 }],
      outputFiles: [{ fileName: 'a.css', bytes: 1024, gzipBytes: 256 }],
    });

    expect(output).toContain('── input files ');
    expect(output).toContain('src/a.scss');
    expect(output).toContain('2.00 kB');
    expect(output).toContain('── output files ');
    expect(output).toContain('a.css');
    expect(output).toContain('0.25 kB');
  });

  it('keeps the listings between the totals and the build result', () => {
    const output = summaryOf({
      inputFiles: [{ path: 'src/a.scss', bytes: 2048 }],
      outputFiles: [{ fileName: 'a.css', bytes: 1024 }],
    });

    expect(output.indexOf('── project ')).toBeLessThan(
      output.indexOf('── input files '),
    );
    expect(output.indexOf('── input files ')).toBeLessThan(
      output.indexOf('── output files '),
    );
    expect(output.indexOf('── output files ')).toBeLessThan(
      output.indexOf('── build '),
    );
  });

  it('drops the gzip column when no file in the table is compressible', () => {
    const output = summaryOf({
      outputFiles: [{ fileName: 'font.woff2', bytes: 4096 }],
    });

    // A column of dashes is worse than no column.
    expect(output).not.toContain('gzip');
  });

  it('shows a dash for a size it could not read', () => {
    const output = summaryOf({
      inputFiles: [{ path: 'src/missing.scss', bytes: undefined }],
    });

    expect(output).toContain('src/missing.scss');
    expect(output).toContain('—');
  });
});

describe('detailed rebuild rendering', () => {
  const rebuildOf = (overrides = {}) =>
    renderRebuild({
      snapshot: emptySnapshot(),
      durationMs: 2350,
      changedFiles: ['/p/src/a.scss'],
      projectDir: '/p',
      detailed: true,
      styler: plain,
      now: new Date(2026, 6, 31, 9, 43, 6),
      ...overrides,
    }).join('\n');

  it('names what the rebuild transformed and what it changed', () => {
    const output = rebuildOf({
      moduleCount: 40,
      changedOutputs: [
        { fileName: 'global/layout/layout.css', bytes: 12800, gzipBytes: 2100 },
      ],
    });

    expect(output).toContain('40 modules transformed');
    expect(output).toContain('1 output changed');
    expect(output).toContain('global/layout/layout.css');
    expect(output).toContain('12.50 kB');
  });

  it('says so when an edit compiled to identical output', () => {
    // The useful negative. Without it a rebuild that changed nothing looks the
    // same as one whose result was never reported.
    const output = rebuildOf({ moduleCount: 40, changedOutputs: [] });

    expect(output).toContain('no output changed');
  });

  it('groups removals separately from the size table', () => {
    const output = rebuildOf({
      changedOutputs: [{ fileName: 'a.css', bytes: 1024 }],
      removedOutputs: ['old.css'],
    });

    expect(output).toContain('1 output removed');
    expect(output).toContain('no longer written');
    expect(output).toContain('old.css');
  });

  it('inflects the module count', () => {
    expect(rebuildOf({ moduleCount: 1 })).toContain('1 module transformed');
    expect(rebuildOf({ moduleCount: 2 })).toContain('2 modules transformed');
  });

  it('stays a single line when not detailed', () => {
    const lines = renderRebuild({
      snapshot: emptySnapshot(),
      durationMs: 84,
      changedFiles: ['/p/src/a.scss'],
      projectDir: '/p',
      moduleCount: 40,
      changedOutputs: [{ fileName: 'a.css', bytes: 1024 }],
      styler: plain,
    });

    expect(lines).toHaveLength(1);
  });

  it('reports a failure instead of the detail block', () => {
    const collector = createDiagnosticsCollector();
    collector.recordError(new Error('boom'));

    const output = rebuildOf({
      snapshot: collector.snapshot(),
      moduleCount: 40,
      changedOutputs: [{ fileName: 'a.css', bytes: 1024 }],
    });

    expect(output).toContain('rebuild failed');
    expect(output).not.toContain('modules transformed');
  });
});

describe('detailed mode through the plugin lifecycle', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'emulsify-plugin-'));

  mkdirSync(join(fixture, 'src'), { recursive: true });
  writeFileSync(join(fixture, 'src/a.scss'), 'a'.repeat(2048));

  /**
   * Drive a reporter plugin through configResolved and a first write.
   *
   * @param {boolean} detailed - Whether detailed mode is on.
   * @returns {{plugin: object, lines: string[], bundle: object}} Harness.
   */
  const harness = (detailed) => {
    const lines = [];
    const plugin = developReporterPlugin({
      env: {
        projectDir: fixture,
        platform: 'drupal',
        projectStructure: {
          sourceRootRecords: [{ name: 'global', directory: `${fixture}/src` }],
        },
      },
      diagnostics: createDiagnosticsCollector(),
      write: (line) => lines.push(line),
      now: () => 0,
      clock: () => new Date(2026, 6, 31, 9, 43, 6),
      colorEnabled: false,
      unicodeEnabled: true,
      detailed,
      version: '4.3.1',
    });

    plugin.configResolved({
      build: {
        watch: {},
        outDir: 'dist/',
        rollupOptions: { input: { a: join(fixture, 'src/a.scss') } },
      },
    });
    lines.length = 0;

    return { plugin, lines };
  };

  it('prints the listings on the first build', () => {
    const { plugin, lines } = harness(true);

    plugin.buildStart();
    plugin.writeBundle(
      {},
      { 'a.css': { type: 'asset', source: 'x'.repeat(1024) } },
    );

    const output = lines.join('\n');
    expect(output).toContain('── input files ');
    expect(output).toContain('src/a.scss');
    expect(output).toContain('── output files ');
    expect(output).toContain('a.css');
  });

  it('prints no listings when detailed mode is off', () => {
    const { plugin, lines } = harness(false);

    plugin.buildStart();
    plugin.writeBundle({}, { 'a.css': { type: 'asset', source: 'x' } });

    const output = lines.join('\n');
    expect(output).not.toContain('input files');
    expect(output).not.toContain('output files');
  });

  it('attaches the module counter only in detailed mode', () => {
    // The hook runs once per module, so the default path should not carry it.
    expect(typeof harness(true).plugin.transform).toBe('function');
    expect(harness(false).plugin.transform).toBeUndefined();
  });

  it('counts the modules a cycle transformed and resets between cycles', () => {
    const { plugin, lines } = harness(true);

    plugin.buildStart();
    plugin.transform('', join(fixture, 'src/a.scss'));
    plugin.transform('', join(fixture, 'src/b.scss'));
    plugin.writeBundle({}, { 'a.css': { type: 'asset', source: 'one' } });
    lines.length = 0;

    plugin.buildStart();
    plugin.transform('', join(fixture, 'src/a.scss'));
    plugin.writeBundle({}, { 'a.css': { type: 'asset', source: 'two' } });

    expect(lines.join('\n')).toContain('1 module transformed');
  });

  it('reports only the outputs a rebuild actually changed', () => {
    const { plugin, lines } = harness(true);

    plugin.buildStart();
    plugin.writeBundle(
      {},
      {
        'a.css': { type: 'asset', source: 'one' },
        'b.css': { type: 'asset', source: 'two' },
      },
    );
    lines.length = 0;

    plugin.buildStart();
    plugin.writeBundle(
      {},
      {
        'a.css': { type: 'asset', source: 'one' },
        'b.css': { type: 'asset', source: 'CHANGED' },
      },
    );

    const output = lines.join('\n');
    expect(output).toContain('1 output changed');
    expect(output).toContain('b.css');
    expect(output).not.toContain('a.css');
  });

  it('leaves the transform hook returning nothing so it never alters code', () => {
    const { plugin } = harness(true);

    plugin.buildStart();
    expect(plugin.transform('body { color: red; }', 'a.scss')).toBe(null);
  });
});
