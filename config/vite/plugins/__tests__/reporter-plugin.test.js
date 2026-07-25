/**
 * @file Tests for the develop reporter plugin, rendering, and format helpers.
 */

import { createDiagnosticsCollector } from '../reporter/diagnostics.js';
import {
  countEntries,
  developReporterPlugin,
  normalizeBuildError,
} from '../reporter/index.js';
import {
  createStyler,
  displayLocation,
  displayPath,
  formatClockTime,
  formatDuration,
  platformLabel,
  pluralize,
  supportsColor,
} from '../reporter/format.js';
import {
  renderBanner,
  renderRebuild,
  renderSummary,
} from '../reporter/render.js';
import { isWatchInvocation } from '../reporter/watch-mode.js';

const plain = createStyler(false);

// Built rather than written literally so the fixture keeps the apostrophe that
// real Sass output contains without tripping the single-quote lint rule.
const APOSTROPHE = String.fromCharCode(39);
const MISSING_STYLESHEET = `Can${APOSTROPHE}t find stylesheet to import.`;

/**
 * Build a plugin harness with captured output and a controllable clock.
 *
 * @param {{platform?: string, projectDir?: string}} [env] - Environment overrides.
 * @returns {{plugin: object, lines: string[], collector: object, advance: (ms: number) => void}} Harness.
 */
function createHarness(env = {}) {
  const lines = [];
  const collector = createDiagnosticsCollector();
  let currentTime = 0;

  const plugin = developReporterPlugin({
    env: { projectDir: '/project', platform: 'drupal', ...env },
    diagnostics: collector,
    write: (line) => lines.push(line),
    now: () => currentTime,
    clock: () => new Date(2026, 6, 25, 14, 31, 22),
    colorEnabled: false,
    version: '4.2.1',
  });

  return {
    plugin,
    lines,
    collector,
    advance: (milliseconds) => {
      currentTime += milliseconds;
    },
  };
}

/**
 * Build a resolved-config shape for the plugin's configResolved hook.
 *
 * @param {{watch?: object|null, entries?: number}} [options] - Config inputs.
 * @returns {object} Resolved config.
 */
const resolvedConfig = ({ watch = {}, entries = 28 } = {}) => ({
  build: {
    watch,
    outDir: 'dist/',
    rollupOptions: {
      input: Object.fromEntries(
        Array.from({ length: entries }, (_, index) => [
          `entry-${index}`,
          `/src/${index}.js`,
        ]),
      ),
    },
  },
});

describe('develop reporter plugin gating', () => {
  it('applies only to build so the Storybook dev server never runs it', () => {
    const { plugin } = createHarness();
    expect(plugin.apply).toBe('build');
  });

  it('stays completely silent for one-shot builds', () => {
    const { plugin, lines } = createHarness();

    plugin.configResolved(resolvedConfig({ watch: null }));
    plugin.buildStart();
    plugin.buildEnd();
    plugin.writeBundle();
    plugin.closeBundle();

    expect(lines).toEqual([]);
  });

  it('prints the banner once when a watch build resolves', () => {
    const { plugin, lines } = createHarness();

    plugin.configResolved(resolvedConfig());

    expect(lines.join('\n')).toContain(
      'emulsify · core 4.2.1 · Platform: Drupal · 28 entries',
    );
  });

  it('reports each cycle exactly once across overlapping lifecycle hooks', () => {
    const { plugin, lines } = createHarness();

    plugin.configResolved(resolvedConfig());
    lines.length = 0;

    plugin.buildStart();
    plugin.writeBundle();
    plugin.closeBundle();

    const built = lines.filter((line) => line.includes('built in'));
    expect(built).toHaveLength(1);
  });
});

describe('develop reporter output', () => {
  it('summarizes a clean first build', () => {
    const { plugin, lines, advance } = createHarness();

    plugin.configResolved(resolvedConfig());
    lines.length = 0;
    plugin.buildStart();
    advance(1420);
    plugin.writeBundle();

    expect(lines.join('\n')).toContain('✓ built in 1.42s · watching dist/');
  });

  it('folds a build error into the summary rather than interrupting', () => {
    const { plugin, lines, advance } = createHarness();

    plugin.configResolved(resolvedConfig());
    lines.length = 0;
    plugin.buildStart();
    advance(900);
    plugin.buildEnd(
      Object.assign(new Error(`[vite:css] [sass] ${MISSING_STYLESHEET}`), {
        loc: {
          file: '/project/src/components/templates/templates.scss',
          line: 1,
        },
      }),
    );

    const output = lines.join('\n');
    expect(output).toContain('✗ build failed after 900ms');
    expect(output).toContain('✗ 1 error');
    expect(output).toContain('src/components/templates/templates.scss:1');
    expect(output).toContain(MISSING_STYLESHEET);
  });

  it('replaces repeated sass output with a single deduplicated tally', () => {
    const { plugin, lines, collector, advance } = createHarness();

    plugin.configResolved(resolvedConfig());
    lines.length = 0;
    plugin.buildStart();

    for (let index = 0; index < 20; index += 1) {
      collector.recordDeprecation({
        id: 'slash-div',
        file: '/project/src/components/base/_variables.scss',
        line: 30,
      });
    }
    for (let index = 0; index < 5; index += 1) {
      collector.recordDeprecation({
        id: 'global-builtin',
        file: '/project/src/components/base/_breakpoints.scss',
        line: 195,
      });
    }

    advance(1420);
    plugin.writeBundle();

    const output = lines.join('\n');
    expect(output).toContain('! 25 sass deprecations · 2 kinds in 2 files');
    expect(output).toContain('slash-div 20 · global-builtin 5');
    expect(output).toContain('src/components/base/_variables.scss:30 (×20)');
    expect(output).toContain('npx sass-migrator division <paths>');
    // The whole tally fits well inside the volume it replaces.
    expect(lines.length).toBeLessThan(12);
  });

  it('prints a compact line for rebuilds instead of a second summary', () => {
    const { plugin, lines, advance } = createHarness();

    plugin.configResolved(resolvedConfig());
    plugin.buildStart();
    plugin.writeBundle();
    lines.length = 0;

    plugin.buildStart();
    plugin.watchChange('/project/src/components/card/card.scss');
    advance(84);
    plugin.writeBundle();

    expect(lines).toEqual([
      '  14:31:22 ~ src/components/card/card.scss · rebuilt in 84ms',
    ]);
  });

  it('does not repeat the deprecation tally on every rebuild', () => {
    const { plugin, lines, collector, advance } = createHarness();

    plugin.configResolved(resolvedConfig());
    plugin.buildStart();
    plugin.writeBundle();
    lines.length = 0;

    plugin.buildStart();
    collector.recordDeprecation({
      id: 'slash-div',
      file: '/project/src/a.scss',
      line: 3,
    });
    advance(50);
    plugin.writeBundle();

    expect(lines.join('\n')).not.toContain('sass deprecations');
  });

  it('names additional changed files without listing them all', () => {
    const { plugin, lines } = createHarness();

    plugin.configResolved(resolvedConfig());
    plugin.buildStart();
    plugin.writeBundle();
    lines.length = 0;

    plugin.buildStart();
    plugin.watchChange('/project/src/a.scss');
    plugin.watchChange('/project/src/b.scss');
    plugin.watchChange('/project/src/c.scss');
    plugin.writeBundle();

    expect(lines[0]).toContain('src/a.scss +2');
  });

  it('surfaces errors on a failed rebuild', () => {
    const { plugin, lines } = createHarness();

    plugin.configResolved(resolvedConfig());
    plugin.buildStart();
    plugin.writeBundle();
    lines.length = 0;

    plugin.buildStart();
    plugin.watchChange('/project/src/a.scss');
    plugin.buildEnd(
      Object.assign(new Error('undefined variable'), {
        id: '/project/src/a.scss',
      }),
    );

    const output = lines.join('\n');
    expect(output).toContain('✗ src/a.scss');
    expect(output).toContain('rebuild failed');
    expect(output).toContain('undefined variable');
  });
});

describe('rendering helpers', () => {
  const emptySnapshot = createDiagnosticsCollector().snapshot();

  it('omits the entry count when it cannot be determined', () => {
    const banner = renderBanner({
      version: '1.0.0',
      platform: 'none',
      styler: plain,
    });
    expect(banner.join('\n')).toContain(
      'emulsify · core 1.0.0 · Platform: none',
    );
    expect(banner.join('\n')).not.toContain('entries');
  });

  it('caps listed errors and reports the remainder as a count', () => {
    const collector = createDiagnosticsCollector();
    for (let index = 0; index < 8; index += 1) {
      collector.recordError({
        message: `boom ${index}`,
        file: `/project/${index}.scss`,
        line: 1,
      });
    }

    const output = renderSummary({
      snapshot: collector.snapshot(),
      durationMs: 100,
      projectDir: '/project',
      styler: plain,
    }).join('\n');

    expect(output).toContain('✗ 8 errors');
    expect(output).toContain('+3 more');
    expect(output).not.toContain('boom 7');
  });

  it('caps the named deprecation kinds', () => {
    const collector = createDiagnosticsCollector();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      collector.recordDeprecation({ id, file: '/project/x.scss', line: 1 });
    }

    const output = renderSummary({
      snapshot: collector.snapshot(),
      durationMs: 10,
      projectDir: '/project',
      styler: plain,
    }).join('\n');

    expect(output).toContain('+2 more');
  });

  it('falls back to a generic label when no changed file is known', () => {
    const output = renderRebuild({
      snapshot: emptySnapshot,
      durationMs: 12,
      styler: plain,
      now: new Date(2026, 6, 25, 9, 5, 3),
    }).join('\n');

    expect(output).toBe('  09:05:03 ~ sources · rebuilt in 12ms');
  });
});

describe('format helpers', () => {
  it('labels known platforms with their conventional casing', () => {
    expect(platformLabel('drupal')).toBe('Drupal');
    expect(platformLabel('wordpress')).toBe('WordPress');
    expect(platformLabel('none')).toBe('none');
    expect(platformLabel('eleventy')).toBe('Eleventy');
    expect(platformLabel(undefined)).toBe('none');
  });

  it('formats durations across the second boundary', () => {
    expect(formatDuration(84)).toBe('84ms');
    expect(formatDuration(999)).toBe('999ms');
    expect(formatDuration(1420)).toBe('1.42s');
    expect(formatDuration(-1)).toBe('0ms');
    expect(formatDuration(Number.NaN)).toBe('0ms');
  });

  it('pads clock components', () => {
    expect(formatClockTime(new Date(2026, 6, 25, 9, 5, 3))).toBe('09:05:03');
  });

  it('relativizes project paths and shortens outside ones', () => {
    expect(displayPath('/project/src/a.scss', '/project')).toBe('src/a.scss');
    expect(displayPath('/project/src/a.scss', '/project/')).toBe('src/a.scss');
    expect(displayPath('/elsewhere/deep/nested/tree/a.scss', '/project')).toBe(
      'nested/tree/a.scss',
    );
    expect(displayPath(undefined)).toBe('<unknown>');
  });

  it('normalizes windows separators', () => {
    expect(displayPath('C:\\project\\src\\a.scss', 'C:\\project')).toBe(
      'src/a.scss',
    );
  });

  it('appends line numbers only when known', () => {
    expect(displayLocation('/project/a.scss', 4, '/project')).toBe('a.scss:4');
    expect(displayLocation('/project/a.scss', undefined, '/project')).toBe(
      'a.scss',
    );
  });

  it('inflects counts', () => {
    expect(pluralize(1, 'error')).toBe('1 error');
    expect(pluralize(2, 'error')).toBe('2 errors');
    expect(pluralize(2, 'entry', 'entries')).toBe('2 entries');
  });

  it('resolves color support from the environment before the stream', () => {
    expect(supportsColor({ NO_COLOR: '1' }, { isTTY: true })).toBe(false);
    expect(supportsColor({ FORCE_COLOR: '1' }, { isTTY: false })).toBe(true);
    expect(supportsColor({ FORCE_COLOR: '0' }, { isTTY: true })).toBe(false);
    expect(supportsColor({}, { isTTY: true })).toBe(true);
    expect(supportsColor({}, { isTTY: false })).toBe(false);
    expect(supportsColor({}, undefined)).toBe(false);
  });

  it('emits ansi only when enabled', () => {
    expect(createStyler(false)('red', 'x')).toBe('x');
    expect(createStyler(true)('red', 'x')).toContain('\u001b[31m');
    expect(createStyler(true)(undefined, 'x')).toBe('x');
    expect(createStyler(true)('not-a-real-format', 'x')).toBe('x');
  });
});

describe('build error normalization', () => {
  it('strips the plugin prefix and keeps the first line', () => {
    expect(
      normalizeBuildError(
        Object.assign(
          new Error(`[vite:css] [sass] ${MISSING_STYLESHEET}\n  ╷\n1 │ @use`),
          {
            loc: { file: '/a.scss', line: 1 },
          },
        ),
      ),
    ).toEqual({
      message: `[sass] ${MISSING_STYLESHEET}`,
      file: '/a.scss',
      line: 1,
    });
  });

  it('falls back to the module id when there is no loc', () => {
    expect(
      normalizeBuildError(Object.assign(new Error('boom'), { id: '/b.scss' })),
    ).toEqual({
      message: 'boom',
      file: '/b.scss',
      line: undefined,
    });
  });

  it('handles string and missing errors', () => {
    expect(normalizeBuildError('plain failure').message).toBe('plain failure');
    expect(normalizeBuildError(undefined).message).toBe('Unknown build error');
    expect(normalizeBuildError(new Error('')).message).toBe(
      'Unknown build error',
    );
  });
});

describe('entry counting', () => {
  it('counts every rollup input shape', () => {
    expect(countEntries({ a: '1', b: '2' })).toBe(2);
    expect(countEntries(['a', 'b', 'c'])).toBe(3);
    expect(countEntries('single')).toBe(1);
    expect(countEntries(undefined)).toBeUndefined();
  });
});

describe('watch invocation detection', () => {
  it('detects the vite watch flags', () => {
    expect(isWatchInvocation(['node', 'vite', 'build', '--watch'])).toBe(true);
    expect(isWatchInvocation(['node', 'vite', 'build', '-w'])).toBe(true);
    expect(isWatchInvocation(['node', 'vite', 'build', '--watch=true'])).toBe(
      true,
    );
  });

  it('rejects one-shot builds and malformed argv', () => {
    expect(isWatchInvocation(['node', 'vite', 'build'])).toBe(false);
    expect(isWatchInvocation(['node', 'storybook', 'build'])).toBe(false);
    expect(isWatchInvocation(undefined)).toBe(false);
  });
});
