/**
 * @file Tests for unresolved CSS asset enrichment and table rendering.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import {
  buildAssetRows,
  createAssetResolver,
} from '../reporter/asset-resolver.js';
import { createDiagnosticsCollector } from '../reporter/diagnostics.js';
import { createStyler } from '../reporter/format.js';
import { renderSummary } from '../reporter/render.js';

const plain = createStyler(false);

describe('asset resolver', () => {
  let projectDir;

  /**
   * Write project files and build a resolver over them.
   *
   * @param {Record<string, string>} files - Project-relative path to contents.
   * @returns {ReturnType<createAssetResolver>} Resolver.
   */
  const withProject = (files) => {
    projectDir = mkdtempSync(join(tmpdir(), 'emulsify-assets-'));
    const absolutePaths = [];

    for (const [relativePath, contents] of Object.entries(files)) {
      const absolutePath = join(projectDir, relativePath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, contents);
      absolutePaths.push({ absPath: absolutePath });
    }

    return createAssetResolver({
      projectDir,
      sourceFileIndex: { all: () => absolutePaths },
    });
  };

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
      projectDir = undefined;
    }
  });

  it('reports the directory an existing asset lives in', () => {
    const resolver = withProject({
      'src/assets/images/bg.png': '',
      'src/components/base/_base.scss':
        '.a { background: url("../images/bg.png"); }',
    });

    expect(resolver.locate('../images/bg.png')).toEqual({
      status: 'found',
      label: 'src/assets/images/',
    });
  });

  it('reports a url whose file exists nowhere as missing', () => {
    const resolver = withProject({
      'src/components/base/_base.scss':
        '.a { background: url("../images/nope.png"); }',
    });

    expect(resolver.locate('../images/nope.png')).toEqual({
      status: 'missing',
      label: 'not found',
    });
  });

  it('reports a count rather than guessing between duplicate basenames', () => {
    const resolver = withProject({
      'src/assets/images/icon.png': '',
      'src/components/card/icon.png': '',
      'src/components/base/_base.scss': '.a { background: url("icon.png"); }',
    });

    expect(resolver.locate('icon.png')).toEqual({
      status: 'ambiguous',
      label: '2 candidates',
    });
  });

  it('ignores query strings and fragments when matching', () => {
    const resolver = withProject({ 'src/assets/images/bg.png': '' });

    expect(resolver.locate('../images/bg.png?v=2').status).toBe('found');
    expect(resolver.locate('../images/bg.png#frag').status).toBe('found');
  });

  it('finds the stylesheet and line that writes the url', () => {
    const resolver = withProject({
      'src/assets/images/bg.png': '',
      'src/components/base/_base.scss': [
        '// heading comment',
        '.a { background: url("../images/bg.png"); }',
      ].join('\n'),
    });

    expect(resolver.references('../images/bg.png')).toEqual([
      { file: 'base/_base.scss', line: 2 },
    ]);
  });

  it('matches the url() specifier exactly rather than by substring', () => {
    const resolver = withProject({
      'src/components/base/_base.scss':
        '.a { background: url("../images/bg.png"); }',
      'src/components/pages/_pages.scss':
        '.b { background: url("images/bg.png"); }',
    });

    // "images/bg.png" is a substring of "../images/bg.png", so a naive search
    // would wrongly attribute it to _base.scss as well.
    expect(resolver.references('images/bg.png')).toEqual([
      { file: 'pages/_pages.scss', line: 1 },
    ]);
  });

  it('handles unquoted and single-quoted url() forms', () => {
    const quote = String.fromCharCode(39);
    const resolver = withProject({
      'src/components/a/_a.scss': '.a { background: url(../img/x.png); }',
      'src/components/b/_b.scss': `.b { background: url(${quote}../img/x.png${quote}); }`,
    });

    expect(resolver.references('../img/x.png').map((r) => r.file)).toEqual([
      'a/_a.scss',
      'b/_b.scss',
    ]);
  });

  it('finds every occurrence within one stylesheet', () => {
    const resolver = withProject({
      'src/components/a/_a.scss': [
        '.a { background: url("../img/x.png"); }',
        '.b { background: url("../img/x.png"); }',
      ].join('\n'),
    });

    expect(resolver.references('../img/x.png')).toEqual([
      { file: 'a/_a.scss', line: 1 },
      { file: 'a/_a.scss', line: 2 },
    ]);
  });

  it('does not scan non-stylesheet files', () => {
    const resolver = withProject({
      'src/components/a/a.js': 'const css = `url("../img/x.png")`;',
    });

    expect(resolver.references('../img/x.png')).toEqual([]);
  });

  it('degrades quietly when no source index is available', () => {
    const resolver = createAssetResolver({});

    expect(resolver.locate('../img/x.png')).toEqual({
      status: 'unknown',
      label: '',
    });
    expect(resolver.references('../img/x.png')).toEqual([]);
  });

  it('survives an index that throws', () => {
    const resolver = createAssetResolver({
      sourceFileIndex: {
        all: () => {
          throw new Error('index unavailable');
        },
      },
    });

    expect(resolver.locate('x.png').status).toBe('unknown');
  });
});

describe('asset row construction', () => {
  /**
   * Build a stub resolver from fixed lookups.
   *
   * @param {object} locations - URL to location result.
   * @param {object} references - URL to reference list.
   * @returns {object} Stub resolver.
   */
  const stubResolver = (locations, references) => ({
    locate: (url) => locations[url] || { status: 'unknown', label: '' },
    references: (url) => references[url] || [],
  });

  it('emits one row per reference so every row is somewhere to go', () => {
    const rows = buildAssetRows(
      [{ url: '../img/x.png' }],
      stubResolver(
        { '../img/x.png': { status: 'found', label: 'src/assets/img/' } },
        {
          '../img/x.png': [
            { file: 'a/_a.scss', line: 3 },
            { file: 'b/_b.scss', line: 7 },
          ],
        },
      ),
    );

    expect(rows).toEqual([
      {
        where: 'a/_a.scss:3',
        url: '../img/x.png',
        status: 'found',
        label: 'src/assets/img/',
      },
      {
        where: 'b/_b.scss:7',
        url: '../img/x.png',
        status: 'found',
        label: 'src/assets/img/',
      },
    ]);
  });

  it('keeps a url with no locatable reference as a single dashed row', () => {
    const rows = buildAssetRows(
      [{ url: '../img/x.png' }],
      stubResolver(
        { '../img/x.png': { status: 'missing', label: 'not found' } },
        {},
      ),
    );

    expect(rows).toEqual([
      {
        where: '—',
        url: '../img/x.png',
        status: 'missing',
        label: 'not found',
      },
    ]);
  });

  it('sorts by referencing file so the list reads as a worklist', () => {
    const rows = buildAssetRows(
      [{ url: 'b.png' }, { url: 'a.png' }],
      stubResolver(
        {},
        {
          'b.png': [{ file: 'atoms/_buttons.scss', line: 1 }],
          'a.png': [{ file: 'pages/_pages.scss', line: 1 }],
        },
      ),
    );

    expect(rows.map((row) => row.where)).toEqual([
      'atoms/_buttons.scss:1',
      'pages/_pages.scss:1',
    ]);
  });
});

describe('asset table rendering', () => {
  /**
   * Render a summary containing the given asset rows.
   *
   * @param {Array<object>} assetRows - Enriched rows.
   * @returns {string} Rendered output.
   */
  const render = (assetRows) => {
    const collector = createDiagnosticsCollector();
    for (const row of assetRows) {
      collector.recordUnresolvedAsset({ url: row.url });
    }

    return renderSummary({
      snapshot: collector.snapshot(),
      durationMs: 100,
      projectDir: '/project',
      assetRows,
      styler: plain,
    }).join('\n');
  };

  const rows = [
    {
      where: 'atoms/_buttons.scss:1',
      url: '../images/plus.png',
      status: 'missing',
      label: 'not found',
    },
    {
      where: 'base/_base.scss:1',
      url: '../images/bg-lines.png',
      status: 'found',
      label: 'src/assets/images/',
    },
  ];

  it('prints a header row above the columns', () => {
    const output = render(rows);

    expect(output).toContain(
      'referenced in          url                     on disk',
    );
  });

  it('tallies found against missing in the headline', () => {
    expect(render(rows)).toContain(
      '! 2 unresolved css urls · 1 found, 1 missing',
    );
  });

  it('aligns the columns regardless of content width', () => {
    const output = render(rows).split('\n');
    const dataRows = output.filter((line) => line.includes('.scss:'));

    const urlColumns = dataRows.map((line) => line.indexOf('../images/'));
    expect(new Set(urlColumns).size).toBe(1);
  });

  it('explains where the paths actually resolve from', () => {
    const output = render(rows);

    expect(output).toContain(
      'paths resolve from dist/, not from the scss file',
    );
    // Vite's own phrasing never reaches the user.
    expect(output).not.toContain('resolved at runtime');
  });

  it('caps a runaway table and reports the remainder', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      where: `a/_a.scss:${index}`,
      url: `../images/a${index}.png`,
      status: 'found',
      label: 'src/assets/images/',
    }));

    const output = render(many);
    expect(output).toContain('+4 more');
  });

  it('says nothing when every url resolved', () => {
    expect(render([])).not.toContain('unresolved css');
  });
});
