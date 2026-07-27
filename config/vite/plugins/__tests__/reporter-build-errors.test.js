/**
 * @file Tests for build error extraction and missing-import reporting.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';

import {
  buildImportRows,
  createAssetResolver,
  sassImportCandidates,
  sharedMissingDirectory,
} from '../reporter/asset-resolver.js';
import {
  classifyBuildError,
  describeBuildError,
  flattenBuildErrors,
} from '../reporter/build-errors.js';
import { createDiagnosticsCollector } from '../reporter/diagnostics.js';
import { createStyler } from '../reporter/format.js';
import { renderSummary } from '../reporter/render.js';
import { createReporterLogger } from '../reporter/vite-logger.js';

const plain = createStyler(false);
const q = String.fromCharCode(39);

/**
 * Build a Sass exception shaped like the real one.
 *
 * Verified against sass 1.101: the exception exposes `span.url`,
 * `span.start.line` (zero-based) and `span.text`.
 *
 * @param {{file: string, line: number, statement: string}} options - Inputs.
 * @returns {Error} Sass-shaped exception.
 */
const sassException = ({ file, line, statement }) =>
  Object.assign(new Error(`Can${q}t find stylesheet to import.`), {
    span: {
      url: pathToFileURL(file),
      start: { line: line - 1, column: 0 },
      text: statement,
    },
  });

/**
 * Wrap errors the way Rolldown aggregates a failed build.
 *
 * `errors` is defined as an enumerable getter on a wrapper whose message is
 * only a count.
 *
 * @param {Array<Error>} errors - Individual errors.
 * @returns {Error} Aggregate wrapper.
 */
const rolldownAggregate = (errors) => {
  const wrapper = new Error(`Build failed with ${errors.length} errors:`);
  Object.defineProperty(wrapper, 'errors', {
    configurable: true,
    enumerable: true,
    get: () => errors,
  });
  return wrapper;
};

/**
 * Build a vite:css plugin error wrapping a Sass exception.
 *
 * @param {{file: string, line: number, statement: string}} options - Inputs.
 * @returns {Error} Plugin error.
 */
const viteCssError = (options) =>
  Object.assign(new Error(`[sass] Can${q}t find stylesheet to import.`), {
    plugin: 'vite:css',
    id: options.file,
    cause: sassException(options),
  });

describe('build error flattening', () => {
  it('unpacks the rolldown aggregate into its individual errors', () => {
    const aggregate = rolldownAggregate([
      new Error('first'),
      new Error('second'),
    ]);

    expect(flattenBuildErrors(aggregate).map((e) => e.message)).toEqual([
      'first',
      'second',
    ]);
  });

  it('passes a lone error through untouched', () => {
    const single = new Error('just one');
    expect(flattenBuildErrors(single)).toEqual([single]);
  });

  it('tolerates a missing or empty aggregate', () => {
    expect(flattenBuildErrors(undefined)).toEqual([]);
    expect(
      flattenBuildErrors(Object.assign(new Error('x'), { errors: [] })),
    ).toHaveLength(1);
  });
});

describe('build error description', () => {
  it('reads file, line, and statement from the sass span', () => {
    const described = describeBuildError(
      viteCssError({
        file: '/p/src/components/base/base.scss',
        line: 10,
        statement: `@forward ${q}../base/layouts/grid/grid-item${q}`,
      }),
    );

    expect(described).toMatchObject({
      message: `Can${q}t find stylesheet to import.`,
      file: '/p/src/components/base/base.scss',
      // Sass spans are zero-based; the reporter is one-based.
      line: 10,
      specifier: '../base/layouts/grid/grid-item',
      isMissingImport: true,
    });
  });

  it('extracts the specifier from use, forward, and import alike', () => {
    for (const keyword of ['use', 'forward', 'import']) {
      const described = describeBuildError(
        viteCssError({
          file: '/p/a.scss',
          line: 1,
          statement: `@${keyword} ${q}../x/y${q} as *`,
        }),
      );
      expect(described.specifier).toBe('../x/y');
    }
  });

  it('falls back to the code frame when no span survives', () => {
    const described = describeBuildError(
      Object.assign(new Error(`[sass] Can${q}t find stylesheet to import.`), {
        plugin: 'vite:css',
        id: '/p/src/a.scss',
        frame: `   ╷\n10 │ @use ${q}../missing${q};\n   │ ^^^^^^^^^^^^^^^^\n   ╵`,
      }),
    );

    expect(described).toMatchObject({
      file: '/p/src/a.scss',
      line: 10,
      specifier: '../missing',
      isMissingImport: true,
    });
  });

  it('strips the plugin prefix from the message', () => {
    expect(describeBuildError(new Error('[vite:css] boom')).message).toBe(
      'boom',
    );
  });

  it('marks non-import failures as ordinary errors', () => {
    const described = describeBuildError(new Error('Undefined variable.'));
    expect(described.isMissingImport).toBe(false);
  });
});

describe('build error classification', () => {
  it('separates missing imports from the aggregate wrapper', () => {
    const aggregate = rolldownAggregate([
      viteCssError({
        file: '/p/src/components/base/base.scss',
        line: 10,
        statement: `@forward ${q}../base/layouts/grid/grid-item${q}`,
      }),
      viteCssError({
        file: '/p/src/components/organisms/card-grid/_card-grid.scss',
        line: 6,
        statement: `@use ${q}../../base/layouts/grid/grid${q} as *`,
      }),
    ]);

    const { importErrors, otherErrors } = classifyBuildError(aggregate);

    expect(importErrors).toHaveLength(2);
    expect(otherErrors).toHaveLength(0);
    expect(importErrors.map((e) => e.specifier)).toEqual([
      '../base/layouts/grid/grid-item',
      '../../base/layouts/grid/grid',
    ]);
  });

  it('keeps a missing import with no parseable specifier as a plain error', () => {
    const { importErrors, otherErrors } = classifyBuildError(
      new Error(`Can${q}t find stylesheet to import.`),
    );

    expect(importErrors).toHaveLength(0);
    expect(otherErrors).toHaveLength(1);
  });
});

describe('import error collection', () => {
  it('collapses the same import reported through two entrypoints', () => {
    const collector = createDiagnosticsCollector();
    const entry = {
      file: '/p/src/components/base/base.scss',
      line: 10,
      specifier: '../base/layouts/grid/grid-item',
    };

    collector.recordImportError(entry);
    collector.recordImportError({ ...entry });

    const snapshot = collector.snapshot();
    expect(snapshot.importErrors).toHaveLength(1);
    expect(snapshot.importErrors[0].count).toBe(2);
    expect(snapshot.hasProblems).toBe(true);
    expect(collector.hasCapturedImportErrors()).toBe(true);
  });

  it('clears captured imports on reset', () => {
    const collector = createDiagnosticsCollector();
    collector.recordImportError({ file: '/a.scss', specifier: '../x' });
    collector.reset();

    expect(collector.hasCapturedImportErrors()).toBe(false);
  });
});

describe('import row construction', () => {
  let projectDir;

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
      projectDir = undefined;
    }
  });

  /**
   * Create a project on disk and return a resolver over it.
   *
   * @param {string[]} files - Project-relative paths to create.
   * @returns {ReturnType<createAssetResolver>} Resolver.
   */
  const withProject = (files) => {
    projectDir = mkdtempSync(join(tmpdir(), 'emulsify-imports-'));

    for (const relativePath of files) {
      const absolutePath = join(projectDir, relativePath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, '');
    }

    return createAssetResolver({ projectDir });
  };

  it('tries the filenames sass itself would try', () => {
    expect(sassImportCandidates('../base/layouts/grid/grid-item')).toEqual([
      '_grid-item.scss',
      'grid-item.scss',
      '_grid-item.sass',
      'grid-item.sass',
      '_index.scss',
      '_index.sass',
    ]);
  });

  it('reports a deleted partial as not found', () => {
    const resolver = withProject(['src/components/base/base.scss']);

    const [row] = buildImportRows(
      [
        {
          file: join(projectDir, 'src/components/base/base.scss'),
          line: 10,
          specifier: '../base/layouts/grid/grid-item',
        },
      ],
      resolver,
      projectDir,
    );

    expect(row).toMatchObject({
      where: 'base/base.scss:10',
      specifier: '../base/layouts/grid/grid-item',
      status: 'missing',
      label: 'not found',
    });
  });

  it('distinguishes a relocated partial from a deleted one', () => {
    const resolver = withProject([
      'src/components/base/base.scss',
      'src/components/base/grid/_grid-item.scss',
    ]);

    const [row] = buildImportRows(
      [
        {
          file: join(projectDir, 'src/components/base/base.scss'),
          line: 10,
          specifier: '../base/layouts/grid/grid-item',
        },
      ],
      resolver,
      projectDir,
    );

    expect(row.status).toBe('moved');
    expect(row.label).toBe('moved? src/components/base/grid/_grid-item.scss');
  });
});

describe('shared missing directory', () => {
  it('names the one directory every failing import resolves into', () => {
    const rows = [
      { expected: '/p/src/components/base/layouts/grid/grid-item' },
      { expected: '/p/src/components/base/layouts/grid/grid' },
    ];

    expect(sharedMissingDirectory(rows, '/p')).toBe(
      'src/components/base/layouts/grid/',
    );
  });

  it('stays quiet when the only common ancestor is meaningless', () => {
    const rows = [{ expected: '/p/src/a/one' }, { expected: '/p/other/b/two' }];

    expect(sharedMissingDirectory(rows, '/p')).toBeUndefined();
  });

  it('ignores rows with no expected location', () => {
    expect(sharedMissingDirectory([{}, {}], '/p')).toBeUndefined();
  });
});

describe('import error rendering', () => {
  const rows = [
    {
      where: 'base/base.scss:10',
      specifier: '../base/layouts/grid/grid-item',
      status: 'missing',
      label: 'not found',
    },
    {
      where: 'card-grid/_card-grid.scss:6',
      specifier: '../../base/layouts/grid/grid',
      status: 'missing',
      label: 'not found',
    },
  ];

  /**
   * Render a summary containing the given import rows.
   *
   * @param {object} importErrors - Import error payload.
   * @returns {string} Rendered output.
   */
  const render = (importErrors) =>
    renderSummary({
      snapshot: createDiagnosticsCollector().snapshot(),
      durationMs: 871,
      projectDir: '/p',
      importErrors,
      styler: plain,
    }).join('\n');

  it('prints a headed table counting stylesheets and errors', () => {
    const output = render({ rows });

    expect(output).toContain('✗ 2 missing stylesheets · 2 import errors');
    expect(output).toMatch(/imported by\s+import\s+on disk/);
    expect(output).toContain('base/base.scss:10');
    expect(output).toContain('../base/layouts/grid/grid-item');
    expect(output).toContain('not found');
  });

  it('counts distinct stylesheets rather than rows', () => {
    const duplicated = [rows[0], { ...rows[1], specifier: rows[0].specifier }];
    expect(render({ rows: duplicated })).toContain(
      '✗ 1 missing stylesheet · 2 import errors',
    );
  });

  it('names the shared directory as the root cause', () => {
    const output = render({
      rows,
      sharedDirectory: 'src/components/base/layouts/grid/',
      directoryExists: false,
    });

    expect(output).toContain(
      'all 2 resolve under src/components/base/layouts/grid/ — directory not found',
    );
  });

  it('omits the not-found note when the directory does exist', () => {
    const output = render({
      rows,
      sharedDirectory: 'src/components/base/layouts/grid/',
      directoryExists: true,
    });

    expect(output).toContain('all 2 resolve under');
    expect(output).not.toContain('directory not found');
  });

  it('marks the build as failed even with no other errors', () => {
    expect(render({ rows })).toContain('✗ build failed after 871ms');
  });

  it('says nothing when every import resolved', () => {
    expect(render({})).not.toContain('missing stylesheet');
  });
});

describe('raw dump suppression', () => {
  /**
   * Build a stub Vite logger.
   *
   * @returns {object} Logger with captured calls.
   */
  const baseLogger = () => ({
    hasWarned: false,
    info: jest.fn(),
    warn: jest.fn(),
    warnOnce: jest.fn(),
    error: jest.fn(),
    clearScreen: jest.fn(),
    hasErrorLogged: jest.fn(() => false),
  });

  const DUMP = `[plugin vite:css] /p/src/components/base/base.scss\nError: [sass] Can${q}t find stylesheet to import.`;

  it('drops the dump once the same errors are in the table', () => {
    const collector = createDiagnosticsCollector();
    collector.recordImportError({ file: '/p/a.scss', specifier: '../x' });

    const base = baseLogger();
    createReporterLogger(collector, base, { verbose: false }).error(DUMP);

    expect(base.error).not.toHaveBeenCalled();
  });

  it('keeps the dump when nothing was captured to replace it', () => {
    const base = baseLogger();
    createReporterLogger(createDiagnosticsCollector(), base, {
      verbose: false,
    }).error(DUMP);

    // An error the reporter could not parse must still reach the user.
    expect(base.error).toHaveBeenCalled();
  });

  it('keeps unrelated errors even when imports were captured', () => {
    const collector = createDiagnosticsCollector();
    collector.recordImportError({ file: '/p/a.scss', specifier: '../x' });

    const base = baseLogger();
    createReporterLogger(collector, base, { verbose: false }).error(
      'something else went wrong',
    );

    expect(base.error).toHaveBeenCalled();
  });

  it('restores raw output under EMULSIFY_VERBOSE', () => {
    const collector = createDiagnosticsCollector();
    collector.recordImportError({ file: '/p/a.scss', specifier: '../x' });

    const base = baseLogger();
    createReporterLogger(collector, base, { verbose: true }).error(DUMP);

    expect(base.error).toHaveBeenCalled();
  });
});
