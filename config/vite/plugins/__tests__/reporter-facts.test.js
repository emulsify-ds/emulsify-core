/**
 * @file Tests for the reporter's project facts block, ready panel, and dividers.
 */

import { createDiagnosticsCollector } from '../reporter/diagnostics.js';
import { createStyler, formatBytes } from '../reporter/format.js';
import { renderFacts, renderReady, renderSummary } from '../reporter/render.js';
import {
  buildInputRows,
  displayRoot,
  summarizeBundle,
} from '../reporter/source-roots.js';

const plain = createStyler(false);

const emptySnapshot = () => createDiagnosticsCollector().snapshot();

describe('source root attribution', () => {
  it('attributes each entry to the root that contains it', () => {
    const rows = buildInputRows({
      entries: {
        a: '/p/src/components/button/button.scss',
        b: '/p/src/components/card/card.js',
        c: '/p/src/layout/grid.scss',
      },
      sourceRootRecords: [
        { name: 'components', directory: '/p/src/components' },
        { name: 'layout', directory: '/p/src/layout' },
      ],
      projectDir: '/p',
    });

    expect(rows).toEqual([
      { name: 'components', path: 'src/components/', count: 2 },
      { name: 'layout', path: 'src/layout/', count: 1 },
    ]);
  });

  it('attributes a component file to its component root, not the src root', () => {
    // Both roots contain the file. Component roots precede global roots, and
    // that ordering is the only thing keeping the count off the `src` row.
    const rows = buildInputRows({
      entries: { a: '/p/src/components/button/button.scss' },
      sourceRootRecords: [
        { name: 'components', directory: '/p/src/components' },
        { name: 'global', directory: '/p/src' },
      ],
      projectDir: '/p',
    });

    expect(rows).toEqual([
      { name: 'components', path: 'src/components/', count: 1 },
      { name: 'global', path: 'src/', count: 0 },
    ]);
  });

  it('reports a configured root that matched nothing', () => {
    // A root sitting at zero is either misspelled in project.emulsify.json or
    // empty on disk. Hiding the row would hide the bug.
    const rows = buildInputRows({
      entries: { a: '/p/src/components/button/button.scss' },
      sourceRootRecords: [
        { name: 'components', directory: '/p/src/components' },
        { name: 'tokens', directory: '/p/src/tokens' },
      ],
      projectDir: '/p',
    });

    expect(rows[1]).toEqual({ name: 'tokens', path: 'src/tokens/', count: 0 });
  });

  it('preserves configured root order rather than sorting', () => {
    const rows = buildInputRows({
      entries: {},
      sourceRootRecords: [
        { name: 'tokens', directory: '/p/src/tokens' },
        { name: 'components', directory: '/p/src/components' },
        { name: 'layout', directory: '/p/src/layout' },
      ],
      projectDir: '/p',
    });

    expect(rows.map((row) => row.name)).toEqual([
      'tokens',
      'components',
      'layout',
    ]);
  });

  it('counts every entry exactly once', () => {
    const entries = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `entry-${index}`,
        index < 7
          ? `/p/src/components/c${index}.scss`
          : `/p/src/layout/l${index}.scss`,
      ]),
    );

    const rows = buildInputRows({
      entries,
      sourceRootRecords: [
        { name: 'components', directory: '/p/src/components' },
        { name: 'layout', directory: '/p/src/layout' },
      ],
      projectDir: '/p',
    });

    const total = rows.reduce((sum, row) => sum + row.count, 0);
    expect(total).toBe(Object.keys(entries).length);
  });

  it('returns nothing when the project structure is unavailable', () => {
    expect(buildInputRows({ entries: { a: '/p/x.scss' } })).toEqual([]);
    expect(buildInputRows()).toEqual([]);
  });

  it('breaks out the conventional global asset directories', () => {
    // A global root is the source directory itself, so without this every
    // stylesheet outside the component roots reports as one opaque `src/` total.
    const rows = buildInputRows({
      entries: {
        a: '/p/src/components/button/button.scss',
        b: '/p/src/foundation/type.scss',
        c: '/p/src/base/reset.scss',
        d: '/p/src/global/print.scss',
      },
      sourceRootRecords: [
        { name: 'components', directory: '/p/src/components' },
        { name: 'global', directory: '/p/src' },
      ],
      globalRootDirectories: ['/p/src'],
      projectDir: '/p',
    });

    expect(rows).toEqual([
      { name: 'components', path: 'src/components/', count: 1 },
      { name: 'foundation', path: 'src/foundation/', count: 1 },
      { name: 'base', path: 'src/base/', count: 1 },
      { name: 'global', path: 'src/global/', count: 1 },
    ]);
  });

  it('lists global directories in convention order, not discovery order', () => {
    const rows = buildInputRows({
      entries: {
        a: '/p/src/global/print.scss',
        b: '/p/src/base/reset.scss',
        c: '/p/src/foundation/type.scss',
      },
      sourceRootRecords: [{ name: 'global', directory: '/p/src' }],
      globalRootDirectories: ['/p/src'],
      projectDir: '/p',
    });

    expect(rows.map((row) => row.name)).toEqual([
      'foundation',
      'base',
      'global',
    ]);
  });

  it('keeps unrecognized directories and bare files on the root row', () => {
    // Splitting every subdirectory would make the block unbounded on a crowded
    // src/, and a loose file has no directory to attribute to.
    const rows = buildInputRows({
      entries: {
        a: '/p/src/foundation/type.scss',
        b: '/p/src/utilities/spacing.scss',
        c: '/p/src/style.scss',
      },
      sourceRootRecords: [{ name: 'global', directory: '/p/src' }],
      globalRootDirectories: ['/p/src'],
      projectDir: '/p',
    });

    expect(rows).toEqual([
      { name: 'foundation', path: 'src/foundation/', count: 1 },
      { name: 'global', path: 'src/', count: 2 },
    ]);
  });

  it('drops the root row when every entry was attributed above it', () => {
    const rows = buildInputRows({
      entries: { a: '/p/src/foundation/type.scss' },
      sourceRootRecords: [{ name: 'global', directory: '/p/src' }],
      globalRootDirectories: ['/p/src'],
      projectDir: '/p',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('foundation');
  });

  it('keeps an empty global root visible', () => {
    const rows = buildInputRows({
      entries: {},
      sourceRootRecords: [{ name: 'global', directory: '/p/src' }],
      globalRootDirectories: ['/p/src'],
      projectDir: '/p',
    });

    expect(rows).toEqual([{ name: 'global', path: 'src/', count: 0 }]);
  });

  it('never splits a configured structure root that happens to be named global', () => {
    // With structureImplementations there are no global roots, so a root named
    // `global` is a component root and inventing rows inside it would be wrong.
    const rows = buildInputRows({
      entries: {
        a: '/p/src/global/foundation/type.scss',
        b: '/p/src/global/base/reset.scss',
      },
      sourceRootRecords: [{ name: 'global', directory: '/p/src/global' }],
      globalRootDirectories: [],
      projectDir: '/p',
    });

    expect(rows).toEqual([{ name: 'global', path: 'src/global/', count: 2 }]);
  });

  it('still counts every entry exactly once when global rows split', () => {
    const entries = {
      a: '/p/src/components/button/button.scss',
      b: '/p/src/foundation/type.scss',
      c: '/p/src/foundation/color.scss',
      d: '/p/src/base/reset.scss',
      e: '/p/src/utilities/spacing.scss',
      f: '/p/src/style.scss',
    };

    const rows = buildInputRows({
      entries,
      sourceRootRecords: [
        { name: 'components', directory: '/p/src/components' },
        { name: 'global', directory: '/p/src' },
      ],
      globalRootDirectories: ['/p/src'],
      projectDir: '/p',
    });

    const total = rows.reduce((sum, row) => sum + row.count, 0);
    expect(total).toBe(Object.keys(entries).length);
  });

  it('renders roots relative to the project with a trailing slash', () => {
    expect(displayRoot('/p/src/components', '/p')).toBe('src/components/');
    expect(displayRoot('/p/components/', '/p')).toBe('components/');
  });

  it('keeps an absolute path for a root outside the project', () => {
    // A `../../` climb is unreadable, and a root outside the project is rare
    // enough that the full path is the more useful thing to print.
    expect(displayRoot('/elsewhere/shared', '/p')).toBe('/elsewhere/shared/');
  });
});

describe('write tally', () => {
  it('reduces a bundle to file count, total bytes, and the largest file', () => {
    const tally = summarizeBundle({
      'style.css': { type: 'asset', source: 'a'.repeat(4096) },
      'main.js': { type: 'chunk', code: 'x'.repeat(1024) },
      'logo.svg': { type: 'asset', source: new Uint8Array(512) },
    });

    expect(tally).toEqual({
      fileCount: 3,
      totalBytes: 4096 + 1024 + 512,
      largest: { fileName: 'style.css', bytes: 4096 },
    });
  });

  it('measures multi-byte characters as bytes rather than as characters', () => {
    const tally = summarizeBundle({
      'a.css': { type: 'asset', source: '€'.repeat(10) },
    });

    expect(tally.totalBytes).toBe(30);
  });

  it('returns nothing for an absent or empty bundle', () => {
    expect(summarizeBundle()).toBeUndefined();
    expect(summarizeBundle({})).toBeUndefined();
  });

  it('formats sizes without implying precision that does not matter', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4096)).toBe('4 kB');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
    expect(formatBytes(-1)).toBe('0 B');
  });
});

describe('facts block', () => {
  const inputRows = [
    { name: 'components', path: 'src/components/', count: 28 },
    { name: 'layout', path: 'src/layout/', count: 6 },
  ];

  it('names every source root with what it contributed', () => {
    const output = renderFacts({
      platform: 'drupal',
      inputRows,
      outDir: 'dist/',
      styler: plain,
    }).join('\n');

    expect(output).toContain('platform');
    expect(output).toContain('Drupal');
    expect(output).toContain('src/components/');
    expect(output).toContain('28 entries');
    expect(output).toContain('src/layout/');
    expect(output).toContain('6 entries');
  });

  it('labels the input block once and indents its continuation rows', () => {
    const rows = renderFacts({
      platform: 'drupal',
      inputRows,
      styler: plain,
    });

    const inputLines = rows.filter((line) => line.includes('src/'));
    expect(inputLines).toHaveLength(2);
    expect(inputLines[0]).toContain('input');
    expect(inputLines[1]).not.toContain('input');
  });

  it('aligns the entry counts into a column across differing digit widths', () => {
    // 28 and 6 have different widths, so without right-aligning the digits the
    // noun lands a column apart and the block stops reading as a table.
    const rows = renderFacts({
      platform: 'drupal',
      inputRows,
      styler: plain,
    }).filter((line) => line.includes('entries'));

    const columns = rows.map((line) => line.indexOf('entries'));
    expect(columns[0]).toBe(columns[1]);
  });

  it('carries the write tally on the output row', () => {
    const output = renderFacts({
      platform: 'drupal',
      inputRows,
      outDir: 'dist/',
      write: {
        fileCount: 41,
        totalBytes: 1024 * 1024,
        largest: { fileName: 'style.css', bytes: 397312 },
      },
      styler: plain,
    }).join('\n');

    expect(output).toContain('41 files');
    expect(output).toContain('1.0 MB');
    expect(output).toContain('largest style.css 388 kB');
  });

  it('states the output directory before the first build has written', () => {
    const output = renderFacts({
      platform: 'none',
      inputRows: [],
      outDir: 'dist/',
      styler: plain,
    }).join('\n');

    expect(output).toContain('dist/');
    expect(output).not.toContain('files');
  });
});

describe('ready panel', () => {
  const urls = {
    local: 'http://localhost:6007/',
    network: 'http://192.168.1.25:6007/',
  };

  it('frames the urls between half-block rules', () => {
    const lines = renderReady({ urls, unicode: true, styler: plain });
    const rules = lines.filter((line) => /[▄▀]/.test(line));

    expect(rules).toHaveLength(2);
    expect(rules[0]).toContain('▄');
    expect(rules[1]).toContain('▀');
  });

  it('measures the rules from the longest row', () => {
    const lines = renderReady({
      urls: {
        local: 'http://localhost:6006/',
        network: 'http://a-very-long-hostname.internal.example.com:6006/',
      },
      unicode: true,
      styler: plain,
    }).filter(Boolean);

    const longest = Math.max(...lines.map((line) => line.length));
    const rules = lines.filter((line) => /^\s*[▄▀]+$/.test(line));

    // A rule shorter than the longest row would read as a broken panel.
    expect(rules).toHaveLength(2);
    for (const rule of rules) expect(rule.length).toBe(longest);
  });

  it('drops the rules where block glyphs would not render', () => {
    const output = renderReady({
      urls,
      unicode: false,
      styler: plain,
    }).join('\n');

    expect(output).not.toMatch(/[▄▀]/);
    expect(output).toContain('http://localhost:6007/');
    expect(output).toContain('http://192.168.1.25:6007/');
  });

  it('reports a port it was not given rather than accepting it silently', () => {
    // Storybook falls forward to the next free port under `--ci`, so a drift
    // usually means a previous session is still serving the requested one.
    const output = renderReady({
      urls: { local: 'http://localhost:6007/' },
      portDrift: { requested: 6006, actual: 6007 },
      unicode: true,
      styler: plain,
    }).join('\n');

    expect(output).toContain('port 6006 in use, using 6007');
    expect(output).toContain('!');
  });

  it('stays quiet when the resolved port is the requested one', () => {
    const output = renderReady({
      urls: { local: 'http://localhost:6006/' },
      portDrift: { requested: 6006, actual: 6006 },
      unicode: true,
      styler: plain,
    }).join('\n');

    expect(output).not.toContain('in use');
    expect(output).toContain('✓');
  });

  it('renders the headline alone when no urls are known', () => {
    const lines = renderReady({ urls: {}, unicode: true, styler: plain });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('storybook ready');
  });
});

describe('problem section dividers', () => {
  const summaryOf = (overrides) =>
    renderSummary({
      snapshot: emptySnapshot(),
      durationMs: 1000,
      styler: plain,
      unicode: true,
      ...overrides,
    }).join('\n');

  it('draws no dividers for a clean build', () => {
    const output = summaryOf({});

    expect(output).not.toContain('needs attention');
    expect(output).not.toContain('pre-existing debt');
  });

  it('labels actionable problems separately from inherited debt', () => {
    const collector = createDiagnosticsCollector();
    collector.recordDeprecation({
      id: 'slash-div',
      file: '/project/a.scss',
      line: 4,
    });

    const output = summaryOf({
      snapshot: collector.snapshot(),
      assetRows: [
        {
          where: 'a.scss:1',
          url: '../img/x.png',
          status: 'missing',
          label: 'not found',
        },
      ],
      projectDir: '/project',
    });

    expect(output).toContain('needs attention');
    expect(output).toContain('pre-existing debt');
    expect(output.indexOf('needs attention')).toBeLessThan(
      output.indexOf('pre-existing debt'),
    );
  });

  it('omits the debt divider when only actionable problems exist', () => {
    const output = summaryOf({
      assetRows: [
        {
          where: 'a.scss:1',
          url: '../img/x.png',
          status: 'missing',
          label: 'not found',
        },
      ],
    });

    expect(output).toContain('needs attention');
    expect(output).not.toContain('pre-existing debt');
  });

  it('omits the attention divider when only debt exists', () => {
    const collector = createDiagnosticsCollector();
    collector.recordDeprecation({
      id: 'slash-div',
      file: '/project/a.scss',
      line: 4,
    });

    const output = summaryOf({
      snapshot: collector.snapshot(),
      projectDir: '/project',
    });

    expect(output).not.toContain('needs attention');
    expect(output).toContain('pre-existing debt');
  });

  it('falls back to ascii rules where box drawing would not render', () => {
    const output = summaryOf({
      unicode: false,
      assetRows: [
        {
          where: 'a.scss:1',
          url: '../img/x.png',
          status: 'missing',
          label: 'not found',
        },
      ],
    });

    expect(output).toContain('-- needs attention');
    expect(output).not.toContain('─');
  });
});
