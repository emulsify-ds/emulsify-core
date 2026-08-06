/**
 * @file Tests for rebuild failure reporting.
 *
 * A mistyped `@use` used to print `rebuilt in 1.69s` and nothing else: the Sass
 * error lands in `snapshot.importErrors`, and the rebuild line derived its
 * verdict from `snapshot.errors` alone. Nothing written, previous CSS still on
 * disk, Storybook unchanged, no signal anywhere. These pin the whole path.
 */

import { createDiagnosticsCollector } from '../reporter/diagnostics.js';
import { developReporterPlugin } from '../reporter/index.js';
import { createStyler } from '../reporter/format.js';
import { hasCycleFailure, renderRebuild } from '../reporter/render.js';
import { parseExternalizedModule } from '../reporter/vite-logger.js';

const plain = createStyler(false);

const rebuild = ({ snapshot, ...overrides } = {}) =>
  renderRebuild({
    durationMs: 200,
    changedFiles: ['/project/src/components/card/card.scss'],
    projectDir: '/project',
    styler: plain,
    now: new Date(2026, 6, 25, 14, 31, 22),
    ...overrides,
    snapshot: {
      errors: [],
      warnings: [],
      importErrors: [],
      syntaxErrors: [],
      deprecations: [],
      deprecationsByFile: [],
      deprecationTotal: 0,
      unresolvedAssets: [],
      ...snapshot,
    },
  }).join('\n');

describe('hasCycleFailure', () => {
  it.each([
    ['errors', { errors: [{ message: 'boom' }] }],
    ['import errors', { importErrors: [{ specifier: './missing' }] }],
    ['syntax errors', { syntaxErrors: [{ message: 'bad' }] }],
  ])('treats %s as a failed cycle', (_label, snapshot) => {
    expect(hasCycleFailure(snapshot)).toBe(true);
  });

  it('treats a clean snapshot as a success', () => {
    expect(
      hasCycleFailure({ errors: [], importErrors: [], syntaxErrors: [] }),
    ).toBe(false);
  });
});

describe('renderRebuild', () => {
  it('fails on a missing import even though errors is empty', () => {
    // The reported bug. Sass import failures never reach snapshot.errors, so a
    // verdict taken from that bucket alone called a broken build successful.
    const output = rebuild({
      snapshot: { importErrors: [{ specifier: '../../atoms/buttons/button' }] },
      importErrors: {
        rows: [
          {
            where: 'card/card.scss:1',
            specifier: '../../atoms/buttons/button',
            status: 'missing',
            label: 'not found',
          },
        ],
      },
    });

    expect(output).toContain('rebuild failed');
    expect(output).not.toContain('rebuilt in');
  });

  it('says the output on disk is now stale', () => {
    // The symptom that made the original bug so confusing: nothing is written
    // when a cycle fails, so the browser keeps showing the previous build.
    const output = rebuild({
      snapshot: { errors: [{ message: 'boom' }] },
      outDir: 'dist',
    });

    expect(output).toContain(
      'output not updated · dist still holds the last successful build',
    );
  });

  it('names the cause rather than only the verdict', () => {
    const output = rebuild({
      snapshot: { importErrors: [{ specifier: '../../atoms/buttons/button' }] },
      importErrors: {
        rows: [
          {
            where: 'card/card.scss:1',
            specifier: '../../atoms/buttons/button',
            status: 'missing',
            label: 'not found',
          },
        ],
      },
    });

    expect(output).toContain('needs attention');
    expect(output).toContain('../../atoms/buttons/button');
    expect(output).toContain('card/card.scss:1');
  });

  it('does not restate deprecation debt on a failed rebuild', () => {
    // Repeating 190 inherited deprecations on every keystroke is the noise the
    // reporter exists to remove; only the first build lists them.
    const output = rebuild({
      snapshot: {
        errors: [{ message: 'boom' }],
        deprecations: [{ id: 'slash-div', occurrences: 12, locations: [] }],
        deprecationsByFile: [
          { file: '/project/src/base/base.scss', occurrences: 12, entries: [] },
        ],
        deprecationTotal: 12,
      },
    });

    expect(output).not.toContain('pre-existing debt');
    expect(output).not.toContain('slash-div');
  });

  it('marks the rebuild that recovers from a failure', () => {
    const output = rebuild({ recovered: true });

    expect(output).toContain('recovered');
    expect(output).toContain('rebuilt in');
  });

  it('leaves an ordinary rebuild unmarked', () => {
    const output = rebuild();

    expect(output).toContain('rebuilt in');
    expect(output).not.toContain('recovered');
    expect(output).not.toContain('output not updated');
  });
});

describe('externalized module notices', () => {
  it.each([
    [
      'Module "path" has been externalized for browser compatibility, imported by "/x/twig.js".',
      { module: 'path', importer: '/x/twig.js' },
    ],
    [
      'Module "fs" has been externalized for browser compatibility',
      { module: 'fs', importer: undefined },
    ],
  ])('parses %s', (message, expected) => {
    expect(parseExternalizedModule(message)).toEqual(expected);
  });

  it('ignores unrelated messages', () => {
    expect(parseExternalizedModule('something else entirely')).toBeNull();
  });

  it('tallies repeats per module rather than per importer', () => {
    // Vite emits this once per importing file on every cycle; the module is the
    // thing a reader can act on, so occurrences collapse onto it.
    const collector = createDiagnosticsCollector();

    collector.recordExternalizedModule({ module: 'path', importer: 'a.js' });
    collector.recordExternalizedModule({ module: 'path', importer: 'b.js' });
    collector.recordExternalizedModule({ module: 'fs', importer: 'a.js' });

    expect(collector.snapshot().externalizedModules).toEqual([
      { module: 'path', importer: 'a.js', count: 2 },
      { module: 'fs', importer: 'a.js', count: 1 },
    ]);
  });
});

describe('reporter recovery state', () => {
  /**
   * Drive the plugin through one watch cycle and return what it printed.
   *
   * @param {object} plugin - Reporter plugin.
   * @param {string[]} lines - Captured output.
   * @param {() => void} seed - Records diagnostics for this cycle.
   * @returns {string} Output for the cycle.
   */
  const cycle = (plugin, lines, seed = () => {}) => {
    const start = lines.length;
    plugin.buildStart();
    seed();
    plugin.writeBundle();
    plugin.closeBundle();

    return lines.slice(start).join('\n');
  };

  it('marks recovery only on the cycle that follows a failure', () => {
    const lines = [];
    const collector = createDiagnosticsCollector();
    const plugin = developReporterPlugin({
      env: { projectDir: '/project', platform: 'none' },
      diagnostics: collector,
      write: (line) => lines.push(line),
      colorEnabled: false,
      version: '4.3.2',
    });

    plugin.configResolved({ build: { watch: {}, outDir: 'dist' } });

    cycle(plugin, lines); // first build, establishes the summary
    const broken = cycle(plugin, lines, () =>
      collector.recordImportError({
        file: '/project/src/components/card/card.scss',
        line: 1,
        specifier: '../../atoms/buttons/button',
      }),
    );
    const fixed = cycle(plugin, lines);
    const ordinary = cycle(plugin, lines);

    expect(broken).toContain('rebuild failed');
    expect(fixed).toContain('recovered');
    expect(ordinary).not.toContain('recovered');
  });
});
