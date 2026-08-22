/**
 * @file Tests for extracted CSS maps in development watch builds.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTempProject } from '../../test-utils/plugins.js';
import { developmentCssSourceMapPlugins } from './development-source-maps.js';

/** Add an emitted asset to the synthetic bundle used by plugin hooks. */
const emitInto = (bundle) => ({
  emitFile(asset) {
    bundle[asset.fileName] = {
      ...asset,
      fileName: asset.fileName,
      name: asset.fileName,
      names: [asset.fileName],
      originalFileNames: [],
      needsCodeReference: false,
    };
    return asset.fileName;
  },
});

describe('development CSS source maps', () => {
  let projectDir;

  afterEach(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  it('emits a sibling map for one direct stylesheet entry in watch mode', () => {
    projectDir = makeTempProject();
    const outDir = join(projectDir, 'dist');
    const entry = join(projectDir, 'src/components/card/card.scss');
    const partial = join(projectDir, 'src/components/shared/_tokens.scss');
    const cssFileName = 'components/card/card.css';
    const css = '.card {\n  color: rebeccapurple;\n}\n/*$vite$:1*/';
    const { capture, emit } = developmentCssSourceMapPlugins({ projectDir });
    const config = { build: { outDir, watch: {}, sourcemap: true } };

    mkdirSync(join(entry, '..'), { recursive: true });
    mkdirSync(join(partial, '..'), { recursive: true });
    writeFileSync(entry, '@use "../shared/tokens";\n.card { color: $ink; }\n');
    writeFileSync(partial, '$ink: rebeccapurple;\n');

    capture.configResolved(config);
    emit.configResolved(config);
    capture.transform.call(
      {
        getCombinedSourcemap: () => ({
          version: 3,
          file: entry,
          names: [],
          sources: [entry, partial],
          sourcesContent: [null, '$ink: rebeccapurple;\n'],
          mappings: 'AAAA;ACAA;ADCA',
        }),
      },
      css,
      entry,
    );

    const bundle = {
      [cssFileName]: {
        type: 'asset',
        fileName: cssFileName,
        source: css,
        originalFileNames: ['src/components/card/card.scss'],
      },
      'components/card/card__style.js': {
        type: 'chunk',
        facadeModuleId: entry,
        viteMetadata: { importedCss: new Set([cssFileName]) },
      },
    };

    emit.generateBundle.call(emitInto(bundle), {}, bundle);

    const mapFileName = `${cssFileName}.map`;
    expect(bundle[cssFileName].source).toContain(
      '/*# sourceMappingURL=card.css.map */',
    );
    expect(bundle[mapFileName]).toBeDefined();

    const sourceMap = JSON.parse(bundle[mapFileName].source);
    expect(sourceMap).toEqual(
      expect.objectContaining({
        file: 'card.css',
        mappings: 'AAAA;ACAA;ADCA',
        sources: [
          '../../../src/components/card/card.scss',
          '../../../src/components/shared/_tokens.scss',
        ],
      }),
    );
    expect(sourceMap.sourcesContent).toEqual([
      readFileSync(entry, 'utf8'),
      '$ink: rebeccapurple;\n',
    ]);
  });

  it('does not emit CSS maps for one-shot production builds', () => {
    projectDir = makeTempProject();
    const entry = join(projectDir, 'src/components/card/card.scss');
    const cssFileName = 'components/card/card.css';
    const { capture, emit } = developmentCssSourceMapPlugins({ projectDir });
    const config = { build: { outDir: join(projectDir, 'dist') } };

    capture.configResolved(config);
    emit.configResolved(config);
    expect(
      capture.transform.call(
        {
          getCombinedSourcemap: () => ({
            version: 3,
            sources: [entry],
            mappings: 'AAAA',
          }),
        },
        '.card {}',
        entry,
      ),
    ).toBeNull();

    const bundle = {
      [cssFileName]: {
        type: 'asset',
        fileName: cssFileName,
        source: '.card {}',
        originalFileNames: ['src/components/card/card.scss'],
      },
    };
    expect(
      emit.generateBundle.call(emitInto(bundle), {}, bundle),
    ).toBeUndefined();
    expect(bundle[`${cssFileName}.map`]).toBeUndefined();
    expect(bundle[cssFileName].source).toBe('.card {}');
  });

  it.each([false, 'hidden', 'inline'])(
    'honors a consumer sourcemap override of %p',
    (sourcemap) => {
      projectDir = makeTempProject();
      const entry = join(projectDir, 'src/components/card/card.scss');
      const { capture } = developmentCssSourceMapPlugins({ projectDir });

      capture.configResolved({
        build: {
          outDir: join(projectDir, 'dist'),
          watch: {},
          sourcemap,
        },
      });

      expect(
        capture.transform.call(
          {
            getCombinedSourcemap: () => ({
              version: 3,
              sources: [entry],
              mappings: 'AAAA',
            }),
          },
          '.card {}',
          entry,
        ),
      ).toBeNull();
    },
  );

  it('preserves remote sourceRoot semantics', () => {
    projectDir = makeTempProject();
    const outDir = join(projectDir, 'dist');
    const entry = join(projectDir, 'src/components/card/card.scss');
    const cssFileName = 'components/card/card.css';
    const { capture, emit } = developmentCssSourceMapPlugins({
      projectDir,
      developmentBuild: true,
    });
    const config = { build: { outDir, sourcemap: true } };

    capture.configResolved(config);
    emit.configResolved(config);
    capture.transform.call(
      {
        getCombinedSourcemap: () => ({
          version: 3,
          sourceRoot: 'https://cdn.example.test/sources/',
          sources: ['theme/card.scss'],
          sourcesContent: ['.card {}'],
          names: [],
          mappings: 'AAAA',
        }),
      },
      '.card {}',
      entry,
    );

    const bundle = {
      [cssFileName]: {
        type: 'asset',
        fileName: cssFileName,
        source: '.card {}',
      },
      'components/card/card__style.js': {
        type: 'chunk',
        facadeModuleId: entry,
        viteMetadata: { importedCss: new Set([cssFileName]) },
      },
    };
    emit.generateBundle.call(emitInto(bundle), {}, bundle);

    expect(JSON.parse(bundle[`${cssFileName}.map`].source)).toEqual(
      expect.objectContaining({
        sourceRoot: 'https://cdn.example.test/sources/',
        sources: ['theme/card.scss'],
      }),
    );
  });

  it('skips a CSS asset composed from more than one captured entry', () => {
    projectDir = makeTempProject();
    const first = join(projectDir, 'src/components/card/card.scss');
    const second = join(projectDir, 'src/components/alert/alert.scss');
    const cssFileName = 'assets/shared.css';
    const { capture, emit } = developmentCssSourceMapPlugins({ projectDir });
    const config = {
      build: {
        outDir: join(projectDir, 'dist'),
        watch: {},
        sourcemap: true,
      },
    };
    const context = {
      getCombinedSourcemap() {
        return {
          version: 3,
          sources: [this.entry],
          mappings: 'AAAA',
        };
      },
    };

    capture.configResolved(config);
    emit.configResolved(config);
    context.entry = first;
    capture.transform.call(context, '.card {}', first);
    context.entry = second;
    capture.transform.call(context, '.alert {}', second);

    const bundle = {
      [cssFileName]: {
        type: 'asset',
        fileName: cssFileName,
        source: '.card {}\n.alert {}',
      },
      'card.js': {
        type: 'chunk',
        facadeModuleId: first,
        viteMetadata: { importedCss: new Set([cssFileName]) },
      },
      'alert.js': {
        type: 'chunk',
        facadeModuleId: second,
        viteMetadata: { importedCss: new Set([cssFileName]) },
      },
    };

    emit.generateBundle.call(emitInto(bundle), {}, bundle);
    expect(bundle[`${cssFileName}.map`]).toBeUndefined();
    expect(bundle[cssFileName].source).not.toContain('sourceMappingURL');
  });
});
