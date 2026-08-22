/**
 * @file Tests for CSS asset URL rebasing.
 *
 * These pin the repair for the three ways a project asset reference ships
 * broken today: a relative URL authored against the emitted CSS location, the
 * bare `assets/...` form, and `/assets/...` pointing into a configured
 * `assets.roots` directory.
 */

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

import { resolveAssetRoots } from '../../utils/asset-roots.js';
import { resolveProjectConfig } from '../../project-config.js';
import { cssAssetUrlRelativizer } from './css-asset-relativizer.js';
import { cssAssetRebasePlugin } from './css-asset-rebase.js';
import {
  assetTailFor,
  planAssetUrl,
  rewriteStylesheetUrls,
  splitUrlSuffix,
} from './asset-url-rebase.js';
import {
  makeEnv,
  makeTempProject,
  writeProjectConfig,
} from '../../test-utils/plugins.js';

const QUOTE = String.fromCharCode(39);

describe('asset URL rebase rules', () => {
  let projectDir;
  let roots;
  let stylesheet;

  beforeEach(() => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'assets/images'), { recursive: true });
    mkdirSync(join(projectDir, 'src/components/card'), { recursive: true });
    writeFileSync(join(projectDir, 'assets/images/x.svg'), '<svg/>');
    writeFileSync(join(projectDir, 'src/components/card/local.svg'), '<svg/>');

    roots = resolveAssetRoots({ projectDir });
    stylesheet = join(projectDir, 'src/components/card/card.scss');
  });

  afterEach(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  describe('splitUrlSuffix', () => {
    it('keeps a query or hash out of the filesystem probe', () => {
      expect(splitUrlSuffix('/assets/x.svg?v=2#id')).toEqual({
        path: '/assets/x.svg',
        suffix: '?v=2#id',
      });
    });
  });

  describe('assetTailFor', () => {
    it.each([
      ['../../assets/images/x.jpg', 'images/x.jpg'],
      ['assets/images/x.jpg', 'images/x.jpg'],
      ['/assets/images/x.jpg', 'images/x.jpg'],
      ['./assets/x.jpg', 'x.jpg'],
    ])('reduces %s to %s', (url, expected) => {
      expect(assetTailFor(url)).toBe(expected);
    });

    it.each([
      // A tail that does not name the published prefix says nothing about
      // being a project asset, so it is never tried against the roots.
      ['../images/x.jpg'],
      ['./local.svg'],
      ['assets'],
      ['/assets/'],
    ])('refuses %s', (url) => {
      expect(assetTailFor(url)).toBe('');
    });
  });

  describe('planAssetUrl', () => {
    it('rebases a relative URL whose depth is wrong', () => {
      // The reported bug: `../../assets/...` is correct from mirrored Drupal
      // SDC output and wrong from every other emitted CSS location.
      expect(
        planAssetUrl('../../assets/images/x.svg', stylesheet, roots),
      ).toMatchObject({
        status: 'rebased',
        url: '/assets/images/x.svg',
        emitAs: 'assets/images/x.svg',
        file: join(projectDir, 'assets/images/x.svg'),
      });
    });

    it('rebases the bare assets/ form', () => {
      // Documented in docs/asset-references.md, but Vite reads it as a package
      // specifier and never emits the asset.
      expect(
        planAssetUrl('assets/images/x.svg', stylesheet, roots),
      ).toMatchObject({
        status: 'rebased',
        url: '/assets/images/x.svg',
      });
    });

    it('preserves a query suffix through the rewrite', () => {
      expect(
        planAssetUrl('../../assets/images/x.svg?v=2', stylesheet, roots).url,
      ).toBe('/assets/images/x.svg?v=2');
    });

    it('publishes an already-canonical URL without rewriting it', () => {
      // Only the asset is missing; churning the CSS text would be a no-op edit.
      expect(
        planAssetUrl('/assets/images/x.svg', stylesheet, roots),
      ).toMatchObject({
        status: 'publish',
        emitAs: 'assets/images/x.svg',
      });
    });

    it('leaves a URL that resolves from the stylesheet to Vite', () => {
      // Vite already handles these correctly, including from Sass partials.
      expect(planAssetUrl('./local.svg', stylesheet, roots).status).toBe(
        'skipped',
      );
    });

    it.each([
      ['interpolation', 'url(#{$path}/x.svg)'],
      ['a Sass variable', '$asset-path'],
      ['a data URI', 'data:image/svg+xml,%3Csvg%3E'],
      ['an absolute platform path', '/sites/default/files/x.png'],
      ['a protocol-relative URL', '//cdn.example.com/x.png'],
      ['a bare package specifier', 'some-pkg/assets/x.svg'],
      ['a fragment', '#gradient'],
    ])('skips %s', (_label, value) => {
      expect(planAssetUrl(value, stylesheet, roots).status).toBe('skipped');
    });

    it('reports a missing asset rather than guessing', () => {
      expect(
        planAssetUrl('../../assets/images/gone.svg', stylesheet, roots),
      ).toMatchObject({ status: 'missing' });
    });

    it('refuses to choose when two roots answer to one URL', () => {
      mkdirSync(join(projectDir, 'src/assets/images'), { recursive: true });
      writeFileSync(join(projectDir, 'src/assets/images/x.svg'), '<svg/>');

      // The bare form, so the stylesheet-relative escape hatch cannot fire:
      // `../../assets/...` from this stylesheet now resolves to the src/assets
      // copy, and a URL that resolves stays Vite's.
      const plan = planAssetUrl(
        'assets/images/x.svg',
        stylesheet,
        resolveAssetRoots({ projectDir }),
      );

      expect(plan.status).toBe('ambiguous');
      expect(plan.candidates).toHaveLength(2);
    });

    it('treats overlapping roots as one hit, not an ambiguity', () => {
      // Declaring `./assets` explicitly still picks up the implicit root; that
      // is a configuration style, not two different files.
      const env = {
        projectDir,
        projectStructure: { assetRoots: [join(projectDir, 'assets')] },
      };

      expect(
        planAssetUrl(
          '../../assets/images/x.svg',
          stylesheet,
          resolveAssetRoots(env),
        ).status,
      ).toBe('rebased');
    });

    it('cannot escape an asset root', () => {
      writeFileSync(join(projectDir, 'secret.txt'), 'no');

      expect(
        planAssetUrl('assets/../secret.txt', stylesheet, roots).status,
      ).toBe('skipped');
    });
  });

  describe('rewriteStylesheetUrls', () => {
    it.each([
      [
        'a block comment',
        `/* background: url(${QUOTE}assets/images/x.svg${QUOTE}); */`,
      ],
      [
        'a trailing line comment',
        '.a { color: red; } // see url(assets/images/x.svg)',
      ],
      ['a quoted string value', '.a { content: "url(assets/images/x.svg)"; }'],
    ])('ignores url() text inside %s', (_label, css) => {
      const onPlan = jest.fn();

      expect(rewriteStylesheetUrls(css, stylesheet, roots, onPlan)).toEqual({
        code: css,
        changed: false,
      });
      expect(onPlan).not.toHaveBeenCalled();
    });

    it('still rewrites a real url() token alongside ignored text', () => {
      const onPlan = jest.fn();
      const css = [
        `/* background: url(${QUOTE}assets/images/x.svg${QUOTE}); */`,
        '.a { color: red; } // see url(assets/images/x.svg)',
        '.b { content: "url(assets/images/x.svg)"; }',
        '.c { background: url(assets/images/x.svg); }',
      ].join('\n');

      expect(rewriteStylesheetUrls(css, stylesheet, roots, onPlan)).toEqual({
        code: css.replace(
          '.c { background: url(assets/images/x.svg); }',
          '.c { background: url(/assets/images/x.svg); }',
        ),
        changed: true,
      });
      expect(onPlan).toHaveBeenCalledTimes(1);
      expect(onPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'rebased',
          originalUrl: 'assets/images/x.svg',
          url: '/assets/images/x.svg',
        }),
        { value: 'assets/images/x.svg' },
      );
    });

    it.each([
      ['an unterminated string', '.bad { content: "unfinished'],
      [
        'an apostrophe in an unquoted URL',
        `.bad { background: url(assets/rock${QUOTE}n.svg); }`,
      ],
    ])('rewrites a URL on the line after %s', (_label, damagedLine) => {
      const realLine = '.real { background: url(assets/images/x.svg); }';
      const css = [damagedLine, realLine].join('\n');

      expect(rewriteStylesheetUrls(css, stylesheet, roots)).toEqual({
        code: css.replace(
          realLine,
          '.real { background: url(/assets/images/x.svg); }',
        ),
        changed: true,
      });
    });

    it('rewrites only what it repairs and reports the rest', () => {
      const seen = [];
      const record = (plan) => seen.push(plan.status);
      const { code, changed } = rewriteStylesheetUrls(
        [
          '.a{background:url("../../assets/images/x.svg")}',
          '.b{background:url(/assets/images/x.svg)}',
          '.c{background:url(../../assets/images/gone.svg)}',
        ].join(''),
        stylesheet,
        roots,
        record,
      );

      expect(changed).toBe(true);
      expect(code).toContain('url("/assets/images/x.svg")');
      expect(code).toContain('url(/assets/images/x.svg)');
      expect(code).toContain('url(../../assets/images/gone.svg)');
      expect(seen).toEqual(['rebased', 'publish', 'missing']);
    });

    it('returns the original string when nothing changed', () => {
      const css = '.a{background:url(data:image/svg+xml,%3Csvg%3E)}';

      expect(rewriteStylesheetUrls(css, stylesheet, roots).code).toBe(css);
    });
  });
});

describe('cssAssetRebasePlugin', () => {
  let projectDir;
  let publishedAssetSources;
  let removablePublishedAssets;

  const setup = (overrides = {}) => {
    projectDir = makeTempProject();
    publishedAssetSources = new Map();
    removablePublishedAssets = new Set();
    mkdirSync(join(projectDir, 'assets/images'), { recursive: true });
    mkdirSync(join(projectDir, 'src/components/card'), { recursive: true });
    writeFileSync(join(projectDir, 'assets/images/x.svg'), '<svg/>');

    return makeEnv(projectDir, {
      projectStructure: { assetRoots: [], ...overrides },
    });
  };

  afterEach(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  const make = (env) =>
    cssAssetRebasePlugin({
      env,
      publishedAssetSources,
      removablePublishedAssets,
    });

  const makeRelativizer = (env) =>
    cssAssetUrlRelativizer({
      assetsRoot: 'assets',
      env,
      publishedAssetSources,
      removablePublishedAssets,
    });

  const transform = (plugin, code, id, context = {}) =>
    plugin.transform.call(
      {
        addWatchFile: jest.fn(),
        emitFile: jest.fn(),
        ...context,
      },
      code,
      id,
    );

  const viteCopyOf = (source) => ({
    type: 'asset',
    originalFileNames: [source],
  });

  it('reports only genuine url() tokens to strict asset diagnostics', () => {
    const env = setup();
    const diagnostics = { recordAssetRebase: jest.fn() };
    const plugin = cssAssetRebasePlugin({
      env,
      diagnostics,
      publishedAssetSources,
      removablePublishedAssets,
    });
    const input = [
      `/* background: url(${QUOTE}assets/images/x.svg${QUOTE}); */`,
      '.a { color: red; } // see url(assets/images/x.svg)',
      '.b { content: "url(assets/images/x.svg)"; }',
      '.c { background: url(assets/images/x.svg); }',
    ].join('\n');

    plugin.configResolved({ build: {} });
    plugin.buildStart();

    const result = transform(
      plugin,
      input,
      join(projectDir, 'src/components/card/card.scss'),
    );

    expect(result.code).toBe(
      input.replace(
        '.c { background: url(assets/images/x.svg); }',
        '.c { background: url(/assets/images/x.svg); }',
      ),
    );
    expect(diagnostics.recordAssetRebase).toHaveBeenCalledTimes(1);
    expect(diagnostics.recordAssetRebase).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'rebased',
        url: 'assets/images/x.svg',
        rewritten: '/assets/images/x.svg',
      }),
    );
  });

  const runBundlePipeline = (env, bundle) => {
    const rebase = make(env);
    const relativizer = makeRelativizer(env);
    const config = { build: { outDir: join(projectDir, 'dist') } };

    rebase.configResolved(config);
    relativizer.configResolved(config);
    rebase.buildStart();
    rebase.generateBundle({}, bundle);
    relativizer.generateBundle({}, bundle);
  };

  it('rewrites a stylesheet URL and records where the file lives', () => {
    const env = setup({ selfContainedOutput: false });
    const plugin = make(env);

    plugin.configResolved({ build: {} });
    plugin.buildStart();

    const result = transform(
      plugin,
      '.a{background:url(../../assets/images/x.svg)}',
      join(projectDir, 'src/components/card/card.scss'),
    );

    expect(result.code).toBe('.a{background:url(/assets/images/x.svg)}');
    // Extracted CSS gets no sourcemap in this pipeline; the empty map is what
    // Vite itself returns and keeps Rollup from warning.
    expect(result.map).toEqual({ mappings: '' });
    // The relativizer needs the source location, not the published one, so a
    // configured assets.roots directory can be reached where it actually is.
    expect(publishedAssetSources.get('assets/images/x.svg')).toBe(
      'assets/images/x.svg',
    );
  });

  it('rewrites an uppercase URL function through the Vite transform', () => {
    const env = setup();
    const plugin = make(env);

    plugin.configResolved({ build: {} });
    plugin.buildStart();

    const result = transform(
      plugin,
      '.a{background:URL(assets/images/x.svg)}',
      join(projectDir, 'src/components/card/card.scss'),
    );

    expect(result.code).toBe('.a{background:url(/assets/images/x.svg)}');
  });

  it('emits each repaired asset once per self-contained build cycle', () => {
    const env = setup();
    const plugin = make(env);
    const emitFile = jest.fn();
    const addWatchFile = jest.fn();
    const context = { emitFile, addWatchFile };
    const importer = join(projectDir, 'src/components/card/card.scss');

    plugin.configResolved({ build: {} });
    plugin.buildStart();

    const result = transform(
      plugin,
      '.a{background:url(../../assets/images/x.svg?v=2)}',
      importer,
      context,
    );
    transform(
      plugin,
      '.b{background:url(/assets/images/x.svg#icon)}',
      importer,
      context,
    );

    expect(result.code).toBe('.a{background:url(/assets/images/x.svg?v=2)}');
    expect(emitFile).toHaveBeenCalledTimes(1);
    expect(emitFile).toHaveBeenCalledWith({
      type: 'asset',
      fileName: 'assets/images/x.svg',
      source: Buffer.from('<svg/>'),
    });
    expect(addWatchFile).toHaveBeenCalledTimes(2);
    expect(publishedAssetSources.size).toBe(0);

    plugin.buildStart();
    transform(
      plugin,
      '.c{background:url(/assets/images/x.svg)}',
      importer,
      context,
    );

    expect(emitFile).toHaveBeenCalledTimes(2);
  });

  it('records the copy Vite emitted for the relativizer to decide', () => {
    const env = setup({ selfContainedOutput: false });
    const plugin = make(env);
    const copiedAsset = viteCopyOf('assets/images/x.svg');
    const bundle = {
      'assets/images/x.svg': copiedAsset,
      'components/card/css/card.css': { type: 'asset', source: '' },
    };

    plugin.configResolved({ build: {} });
    plugin.buildStart();
    plugin.generateBundle({}, bundle);

    expect(bundle['assets/images/x.svg']).toBe(copiedAsset);
    expect(publishedAssetSources.get('assets/images/x.svg')).toBe(
      'assets/images/x.svg',
    );
    expect(removablePublishedAssets).toEqual(new Set(['assets/images/x.svg']));
  });

  it('rewrites and removes a Vite-resolved src/assets copy', () => {
    const env = setup({ selfContainedOutput: false });
    mkdirSync(join(projectDir, 'src/assets/images'), { recursive: true });
    writeFileSync(join(projectDir, 'src/assets/images/hero.jpg'), 'hero');
    const bundle = {
      'src/assets/images/hero.jpg': viteCopyOf('src/assets/images/hero.jpg'),
      'components/card/css/card.css': {
        type: 'asset',
        source: '.card{background:url(/src/assets/images/hero.jpg?v=2#hero)}',
      },
    };

    runBundlePipeline(env, bundle);

    expect(bundle['src/assets/images/hero.jpg']).toBeUndefined();
    expect(bundle['components/card/css/card.css'].source).toBe(
      '.card{background:url(../../../../src/assets/images/hero.jpg?v=2#hero)}',
    );
    expect(publishedAssetSources.get('src/assets/images/hero.jpg')).toBe(
      'src/assets/images/hero.jpg',
    );
  });

  it('rewrites and removes a Vite-resolved configured-root copy', () => {
    const env = setup({ selfContainedOutput: false });
    const configuredRoot = join(projectDir, 'design-system/assets');
    env.projectStructure.assetRoots = [configuredRoot];
    mkdirSync(join(configuredRoot, 'images'), { recursive: true });
    writeFileSync(join(configuredRoot, 'images/hero.jpg'), 'hero');
    const bundle = {
      'design-system/assets/images/hero.jpg': viteCopyOf(
        'design-system/assets/images/hero.jpg',
      ),
      'components/card/css/card.css': {
        type: 'asset',
        source: '.card{background:url(/design-system/assets/images/hero.jpg)}',
      },
    };

    runBundlePipeline(env, bundle);

    expect(bundle['design-system/assets/images/hero.jpg']).toBeUndefined();
    expect(bundle['components/card/css/card.css'].source).toBe(
      '.card{background:url(../../../../design-system/assets/images/hero.jpg)}',
    );
    expect(
      publishedAssetSources.get('design-system/assets/images/hero.jpg'),
    ).toBe('design-system/assets/images/hero.jpg');
  });

  it.each([
    [
      'the emitted URL is malformed',
      '.card{background:url(\'/src/assets/images/hero.jpg")}',
    ],
    [
      'the emitted relative URL names a different bundle path',
      '.card{background:url(../../src/assets/images/hero.jpg)}',
    ],
    [
      'a bare relative URL only resembles a bundle-root path',
      '.card{background:url(src/assets/images/hero.jpg)}',
    ],
  ])('keeps a Vite copy when %s', (_label, css) => {
    const env = setup({ selfContainedOutput: false });
    mkdirSync(join(projectDir, 'src/assets/images'), { recursive: true });
    writeFileSync(join(projectDir, 'src/assets/images/hero.jpg'), 'hero');
    const copiedAsset = viteCopyOf('src/assets/images/hero.jpg');
    const bundle = {
      'src/assets/images/hero.jpg': copiedAsset,
      'components/card/css/card.css': { type: 'asset', source: css },
    };

    runBundlePipeline(env, bundle);

    expect(bundle['src/assets/images/hero.jpg']).toBe(copiedAsset);
    expect(bundle['components/card/css/card.css'].source).toBe(css);
  });

  it('rewrites a matching relative emitted URL before removing its copy', () => {
    const env = setup({ selfContainedOutput: false });
    mkdirSync(join(projectDir, 'src/assets/images'), { recursive: true });
    writeFileSync(join(projectDir, 'src/assets/images/hero.jpg'), 'hero');
    const bundle = {
      'src/assets/images/hero.jpg': viteCopyOf('src/assets/images/hero.jpg'),
      'components/card/css/card.css': {
        type: 'asset',
        source: '.card{background:url(../../../src/assets/images/hero.jpg)}',
      },
    };

    runBundlePipeline(env, bundle);

    expect(bundle['src/assets/images/hero.jpg']).toBeUndefined();
    expect(bundle['components/card/css/card.css'].source).toBe(
      '.card{background:url(../../../../src/assets/images/hero.jpg)}',
    );
  });

  it('deletes only assets whose emitted CSS now reaches the source', () => {
    const env = setup({ selfContainedOutput: false });
    mkdirSync(join(projectDir, 'src/assets/images'), { recursive: true });
    for (const name of ['css-only.jpg', 'shared.jpg']) {
      writeFileSync(join(projectDir, `src/assets/images/${name}`), name);
    }
    writeFileSync(join(projectDir, 'assets/images/js-only.jpg'), 'js');

    const cssFileName = 'components/card/css/card.css';
    const bundle = {
      'src/assets/images/css-only.jpg': viteCopyOf(
        'src/assets/images/css-only.jpg',
      ),
      'src/assets/images/shared.jpg': viteCopyOf(
        'src/assets/images/shared.jpg',
      ),
      'assets/images/js-only.jpg': viteCopyOf('assets/images/js-only.jpg'),
      [cssFileName]: {
        type: 'asset',
        source: [
          '.css{background:url(/src/assets/images/css-only.jpg)}',
          '.shared{background:url(/src/assets/images/shared.jpg)}',
        ].join(''),
      },
      'components/card/css/card.js': {
        type: 'chunk',
        code: '',
        facadeModuleId: join(projectDir, 'src/components/card/card.scss'),
        viteMetadata: {
          importedAssets: new Set([
            'src/assets/images/css-only.jpg',
            'src/assets/images/shared.jpg',
          ]),
          importedCss: new Set([cssFileName]),
        },
      },
      'components/card/js/card.js': {
        type: 'chunk',
        code: [
          'const jsOnly = "/assets/images/js-only.jpg";',
          'const shared = "/src/assets/images/shared.jpg";',
        ].join(''),
        viteMetadata: {
          importedAssets: new Set([
            'assets/images/js-only.jpg',
            'src/assets/images/shared.jpg',
          ]),
        },
      },
    };
    const originalAssets = new Map(
      Object.entries(bundle)
        .filter(
          ([fileName, output]) =>
            output.type === 'asset' && !fileName.endsWith('.css'),
        )
        .map(([fileName, output]) => [
          fileName,
          resolve(projectDir, output.originalFileNames[0]),
        ]),
    );

    runBundlePipeline(env, bundle);

    const cssSource = bundle[cssFileName].source;
    const cssTargets = Array.from(cssSource.matchAll(/url\(([^)]+)\)/g)).map(
      ([, value]) =>
        resolve(
          dirname(join(projectDir, 'dist', cssFileName)),
          value.replace(/^['"]|['"]$/g, ''),
        ),
    );
    const deletedAssets = Array.from(originalAssets.keys()).filter(
      (fileName) => !bundle[fileName],
    );

    expect(deletedAssets).toEqual(['src/assets/images/css-only.jpg']);
    for (const fileName of deletedAssets) {
      expect(cssTargets).toContain(originalAssets.get(fileName));
    }
    expect(bundle['assets/images/js-only.jpg']).toBeDefined();
    expect(bundle['src/assets/images/shared.jpg']).toBeDefined();
  });

  it('keeps Vite asset copies in self-contained output', () => {
    const env = setup();
    const plugin = make(env);
    const copiedAsset = viteCopyOf('assets/images/x.svg');
    const bundle = {
      'assets/images/x.svg': copiedAsset,
      'components/card/css/card.css': { type: 'asset', source: '' },
    };

    plugin.configResolved({ build: {} });
    plugin.buildStart();
    plugin.generateBundle({}, bundle);

    expect(bundle['assets/images/x.svg']).toBe(copiedAsset);
    expect(publishedAssetSources.size).toBe(0);
  });

  it('keeps the generated SVG sprite in lean output', () => {
    // The sprite and the JS chunks carry no originalFileNames, which is what
    // separates build output from a copy of a source file.
    const env = setup({ selfContainedOutput: false });
    const sprite = {
      type: 'asset',
      fileName: 'assets/icons.svg',
      originalFileNames: [],
      source: '<svg/>',
    };
    const bundle = {
      'assets/icons.svg': sprite,
      'components/card/css/card.css': {
        type: 'asset',
        originalFileNames: ['src/components/card/card.scss'],
        source: '.icon{mask:url(/assets/icons.svg)}',
      },
      'components/card/js/card.js': { type: 'chunk', code: '' },
    };

    runBundlePipeline(env, bundle);

    expect(bundle['assets/icons.svg']).toBe(sprite);
    expect(bundle['components/card/css/card.css'].source).toBe(
      '.icon{mask:url(../../../assets/icons.svg)}',
    );
    expect(publishedAssetSources.size).toBe(0);
    expect(removablePublishedAssets.size).toBe(0);
  });

  it('leaves assets sourced from outside an asset root alone', () => {
    const env = setup();
    const plugin = make(env);
    const bundle = {
      'src/components/card/hero.jpg': viteCopyOf(
        'src/components/card/hero.jpg',
      ),
    };

    plugin.configResolved({ build: {} });
    plugin.buildStart();
    plugin.generateBundle({}, bundle);

    expect(Object.keys(bundle)).toEqual(['src/components/card/hero.jpg']);
  });

  it('rewrites but keeps the copies under a Storybook build', () => {
    // Storybook copies every asset root into its own output and serves them at
    // /assets, so its bundle has to keep them and its CSS stays self-contained.
    const env = setup();
    const plugin = make(env);
    const bundle = {
      'assets/images/x.svg': viteCopyOf('assets/images/x.svg'),
    };

    plugin.configResolved({ build: { assetsDir: 'storybook-assets' } });
    plugin.buildStart();

    const result = transform(
      plugin,
      '.a{background:url(../../assets/images/x.svg)}',
      join(projectDir, 'src/components/card/card.scss'),
    );
    plugin.generateBundle({}, bundle);

    expect(result.code).toContain('/assets/images/x.svg');
    expect(Object.keys(bundle)).toEqual(['assets/images/x.svg']);
    expect(publishedAssetSources.size).toBe(0);
  });

  it('drops a stale map between watch rebuilds', () => {
    const env = setup({ selfContainedOutput: false });
    const plugin = make(env);

    plugin.configResolved({ build: {} });
    plugin.buildStart();
    transform(
      plugin,
      '.a{background:url(../../assets/images/x.svg)}',
      join(projectDir, 'src/components/card/card.scss'),
    );

    // A rebuild where the reference was deleted must not keep steering URLs.
    plugin.buildStart();

    expect(publishedAssetSources.size).toBe(0);
  });

  it.each([
    ['a non-stylesheet request', 'src/components/card/card.js'],
    ['a raw import', 'src/components/card/card.scss?raw'],
  ])('ignores %s', (_label, relativeId) => {
    const env = setup();
    const plugin = make(env);

    plugin.configResolved({ build: {} });
    plugin.buildStart();

    expect(
      transform(
        plugin,
        '.a{background:url(../../assets/images/x.svg)}',
        join(projectDir, relativeId),
      ),
    ).toBeNull();
  });

  it('switches off the full pipeline with assets.rebase', () => {
    const env = setup({ assetRebase: false });
    const rebase = make(env);
    const relativizer = makeRelativizer(env);
    const input = [
      '.relative{background:url(../assets/images/x.svg)}',
      '.canonical{background:url("/assets/images/x.svg")}',
    ].join('');
    const copiedAsset = viteCopyOf('assets/images/x.svg');
    const bundle = {
      'assets/images/x.svg': copiedAsset,
      'components/card/css/card.css': {
        type: 'asset',
        source: input,
      },
    };
    const config = { build: { outDir: join(projectDir, 'dist') } };

    rebase.configResolved(config);
    relativizer.configResolved(config);
    rebase.buildStart();

    expect(
      transform(
        rebase,
        input,
        join(projectDir, 'src/components/card/card.scss'),
      ),
    ).toBeNull();

    rebase.generateBundle({}, bundle);
    relativizer.generateBundle({}, bundle);

    expect(bundle['assets/images/x.svg']).toBe(copiedAsset);
    expect(bundle['components/card/css/card.css'].source).toBe(input);
    expect(publishedAssetSources.size).toBe(0);
  });

  it('reads assets.rebase and assets.roots off project.emulsify.json', () => {
    projectDir = makeTempProject();
    publishedAssetSources = new Map();
    mkdirSync(join(projectDir, 'design-system/assets/brand'), {
      recursive: true,
    });
    writeFileSync(
      join(projectDir, 'design-system/assets/brand/logo.svg'),
      '<svg/>',
    );
    writeProjectConfig(projectDir, {
      project: { platform: 'none' },
      assets: {
        roots: ['./design-system/assets'],
        selfContainedOutput: false,
      },
    });

    const env = resolveProjectConfig(projectDir, {});
    const plugin = make(env);

    plugin.configResolved({ build: {} });
    plugin.buildStart();

    // Storybook mounts configured roots at /assets, so authors write
    // `/assets/brand/logo.svg` — which Vite alone cannot resolve, and which
    // does not name the directory the file is actually in.
    expect(
      transform(
        plugin,
        '.a{background:url(/assets/brand/logo.svg)}',
        join(projectDir, 'src/components/card/card.scss'),
      ),
    ).toBeNull();

    expect(publishedAssetSources.get('assets/brand/logo.svg')).toBe(
      'design-system/assets/brand/logo.svg',
    );
    expect(env.assetRebase).toBe(true);
    expect(env.selfContainedOutput).toBe(false);
  });

  it('emits configured-root assets into self-contained output', () => {
    projectDir = makeTempProject();
    publishedAssetSources = new Map();
    mkdirSync(join(projectDir, 'design-system/assets/brand'), {
      recursive: true,
    });
    writeFileSync(
      join(projectDir, 'design-system/assets/brand/logo.svg'),
      '<svg/>',
    );
    writeProjectConfig(projectDir, {
      project: { platform: 'none' },
      assets: { roots: ['./design-system/assets'] },
    });

    const env = resolveProjectConfig(projectDir, {});
    const plugin = make(env);
    const emitFile = jest.fn();

    plugin.configResolved({ build: {} });
    plugin.buildStart();
    transform(
      plugin,
      '.a{background:url(/assets/brand/logo.svg)}',
      join(projectDir, 'src/components/card/card.scss'),
      { emitFile },
    );

    expect(env.selfContainedOutput).toBe(true);
    expect(env.projectStructure.selfContainedOutput).toBe(true);
    expect(emitFile).toHaveBeenCalledWith({
      type: 'asset',
      fileName: 'assets/brand/logo.svg',
      source: Buffer.from('<svg/>'),
    });
    expect(publishedAssetSources.size).toBe(0);
  });

  it('feeds the relativizer, which then produces the emitted depth', () => {
    // Ordering contract from config/vite/plugins/index.js: rebase normalizes to
    // /assets/... and fills the map, and only then can the relativizer point
    // the URL at the file. Reverse the two and an absolute URL ships.
    const env = setup({ selfContainedOutput: false });
    const plugin = make(env);

    plugin.configResolved({ build: {} });
    plugin.buildStart();

    const { code } = transform(
      plugin,
      '.a{background:url(../../assets/images/x.svg)}',
      join(projectDir, 'src/components/card/card.scss'),
    );

    const bundle = {
      'components/card/css/card.css': {
        type: 'asset',
        fileName: 'components/card/css/card.css',
        source: code,
      },
    };
    plugin.generateBundle({}, bundle);

    const relativizer = makeRelativizer(env);
    relativizer.configResolved({ build: { outDir: join(projectDir, 'dist') } });
    relativizer.generateBundle({}, bundle);

    expect(bundle['components/card/css/card.css'].source).toBe(
      '.a{background:url(../../../../assets/images/x.svg)}',
    );
  });

  it('feeds the relativizer a self-contained emitted asset', () => {
    const env = setup();
    const plugin = make(env);
    const bundle = {};
    const emitFile = jest.fn((asset) => {
      bundle[asset.fileName] = asset;
    });

    plugin.configResolved({ build: {} });
    plugin.buildStart();

    const { code } = transform(
      plugin,
      '.a{background:url(../../assets/images/x.svg)}',
      join(projectDir, 'src/components/card/card.scss'),
      { emitFile },
    );
    bundle['components/card/css/card.css'] = {
      type: 'asset',
      fileName: 'components/card/css/card.css',
      source: code,
    };

    plugin.generateBundle({}, bundle);

    const relativizer = makeRelativizer(env);
    relativizer.configResolved({ build: { outDir: join(projectDir, 'dist') } });
    relativizer.generateBundle({}, bundle);

    expect(bundle['assets/images/x.svg']).toMatchObject({
      type: 'asset',
      fileName: 'assets/images/x.svg',
      source: Buffer.from('<svg/>'),
    });
    expect(bundle['components/card/css/card.css'].source).toBe(
      '.a{background:url(../../../assets/images/x.svg)}',
    );
    expect(publishedAssetSources.size).toBe(0);
  });
});
