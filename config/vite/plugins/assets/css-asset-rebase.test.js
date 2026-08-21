/**
 * @file Tests for CSS asset URL rebasing.
 *
 * These pin the repair for the three ways a project asset reference ships
 * broken today: a relative URL authored against the emitted CSS location, the
 * bare `assets/...` form, and `/assets/...` pointing into a configured
 * `assets.roots` directory.
 */

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

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

  const setup = (overrides = {}) => {
    projectDir = makeTempProject();
    publishedAssetSources = new Map();
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

  const make = (env) => cssAssetRebasePlugin({ env, publishedAssetSources });

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

  it('removes the copy Vite emitted of a project asset', () => {
    // dist/ is build output. The theme's assets/ is source and already
    // web-served, so shipping the same bytes twice is what this prevents.
    const env = setup({ selfContainedOutput: false });
    const plugin = make(env);
    const bundle = {
      'assets/images/x.svg': viteCopyOf('assets/images/x.svg'),
      'components/card/css/card.css': { type: 'asset', source: '' },
    };

    plugin.configResolved({ build: {} });
    plugin.buildStart();
    plugin.generateBundle({}, bundle);

    expect(Object.keys(bundle)).toEqual(['components/card/css/card.css']);
    expect(publishedAssetSources.get('assets/images/x.svg')).toBe(
      'assets/images/x.svg',
    );
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

  it('keeps generated output and compiled CSS in the bundle', () => {
    // The sprite and the JS chunks carry no originalFileNames, which is what
    // separates build output from a copy of a source file.
    const env = setup();
    const plugin = make(env);
    const bundle = {
      'assets/icons.svg': { type: 'asset', originalFileNames: [] },
      'components/card/css/card.css': {
        type: 'asset',
        originalFileNames: ['src/components/card/card.scss'],
        source: '',
      },
      'components/card/js/card.js': { type: 'chunk', code: '' },
    };

    plugin.configResolved({ build: {} });
    plugin.buildStart();
    plugin.generateBundle({}, bundle);

    expect(Object.keys(bundle)).toEqual([
      'assets/icons.svg',
      'components/card/css/card.css',
      'components/card/js/card.js',
    ]);
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
    const relativizer = cssAssetUrlRelativizer({
      assetsRoot: 'assets',
      env,
      publishedAssetSources,
    });
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

    const relativizer = cssAssetUrlRelativizer({
      assetsRoot: 'assets',
      env,
      publishedAssetSources,
    });
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

    const relativizer = cssAssetUrlRelativizer({
      assetsRoot: 'assets',
      env,
      publishedAssetSources,
    });
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
