/**
 * @file Tests for the CSS asset URL relativizer.
 *
 * The relativizer decides the path every emitted stylesheet uses to reach a
 * project asset, and that path differs per project shape. Nothing pinned it
 * before this file, which is why the shape-dependent breakage it half-covers
 * went unnoticed.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { cssAssetUrlRelativizer } from './css-asset-relativizer.js';

// The lint rule bans double-quoted strings, and these fixtures need a literal
// single quote to exercise CSS quote handling.
const QUOTE = String.fromCharCode(39);
const DOUBLE_QUOTE = String.fromCharCode(34);

const cssAsset = (fileName, source) => ({
  [fileName]: { type: 'asset', fileName, source },
});

/**
 * Run the plugin over a bundle after resolving a config for it.
 *
 * @param {object} bundle - Rollup bundle.
 * @param {object} [options={}] - Plugin and config options.
 * @returns {object} The mutated bundle.
 */
// The rebase plugin records every asset it repaired or stripped, so the
// realistic default is a map that points each published path at its source.
const DEFAULT_SOURCES = new Map([
  ['assets/images/x.svg', 'assets/images/x.svg'],
  ['assets/x.svg', 'assets/x.svg'],
  ['static/x.svg', 'static/x.svg'],
]);

const runOn = (
  bundle,
  { build = { outDir: 'dist' }, config = {}, ...opts } = {},
) => {
  const plugin = cssAssetUrlRelativizer({
    env: { projectDir: '/p' },
    publishedAssetSources: DEFAULT_SOURCES,
    ...opts,
  });
  plugin.configResolved({ ...config, build });
  plugin.generateBundle({}, bundle);

  return bundle;
};

const sourceOf = (fileName, source, options) =>
  runOn(cssAsset(fileName, source), options)[fileName].source;

describe('cssAssetUrlRelativizer', () => {
  it('is a build-only plugin under a stable name', () => {
    const plugin = cssAssetUrlRelativizer();

    // plugins.test.js asserts this name is present in the chain; keep the two
    // in agreement.
    expect(plugin.name).toBe('emulsify-css-asset-url-relativizer');
    expect(plugin.apply).toBe('build');
  });

  it.each([
    // dist/ is build output and the theme's assets/ is source, so a stylesheet
    // inside the output climbs out of it. Each project shape emits its CSS at a
    // different level, and every one has to land on <theme>/assets/images/x.svg.
    ['components/card/css/card.css', '../../../../assets/images/x.svg'],
    ['global/base/css/base.css', '../../../../assets/images/x.svg'],
    ['css/button/button.css', '../../../assets/images/x.svg'],
    [
      'css/src/foundation/colors/colors.css',
      '../../../../../assets/images/x.svg',
    ],
    [
      'storybook/components/card/cl-card.css',
      '../../../../assets/images/x.svg',
    ],
  ])('rewrites %s out of the output directory', (fileName, expected) => {
    expect(sourceOf(fileName, '.a{background:url(/assets/images/x.svg)}')).toBe(
      `.a{background:url(${expected})}`,
    );
  });

  it('keeps mirrored component CSS at its project-root depth', () => {
    // Drupal SDC output is moved out of dist/ to <theme>/components/, so the
    // path inside the output is already the project-relative one.
    expect(
      sourceOf(
        'components/card/card.css',
        '.a{background:url(/assets/x.svg)}',
        {
          env: {
            projectDir: '/p',
            projectStructure: { mirrorComponentOutput: true },
          },
        },
      ),
    ).toBe('.a{background:url(../../assets/x.svg)}');
  });

  it('honors a custom output directory', () => {
    expect(
      sourceOf(
        'components/card/card.css',
        '.a{background:url(/assets/x.svg)}',
        {
          build: { outDir: '/p/build/theme' },
        },
      ),
    ).toBe('.a{background:url(../../../../assets/x.svg)}');
  });

  it('stays inside the output for a Storybook build', () => {
    // Storybook copies every asset root into its own output and serves them at
    // /assets, so reaching outside that output would break the mount. Those
    // copies sit outside Rollup's bundle, so an absent bundle entry must not
    // prevent this rewrite.
    expect(
      sourceOf('assets/preview-hash.css', '.a{background:url(/assets/x.svg)}', {
        build: { outDir: '.out', assetsDir: 'storybook-assets' },
        publishedAssetSources: new Map(),
      }),
    ).toBe('.a{background:url(x.svg)}');
  });

  it('points at where a published asset actually lives', () => {
    // A configured assets.roots directory is served at /assets but is not the
    // `assets/` directory, so the URL has to name the real location.
    expect(
      sourceOf(
        'components/card/css/card.css',
        '.a{background:url(/assets/brand/logo.svg)}',
        {
          publishedAssetSources: new Map([
            ['assets/brand/logo.svg', 'design-system/assets/brand/logo.svg'],
          ]),
        },
      ),
    ).toBe(
      '.a{background:url(../../../../design-system/assets/brand/logo.svg)}',
    );
  });

  it('resolves a generated asset from inside the output', () => {
    // The SVG sprite really is build output, so it has no source mapping and
    // must stay output-relative. svg-sprite.js registers ahead of this plugin
    // in plugins/index.js, so its emit is already in the bundle by the time
    // this runs — the fixture has to carry it or this asserts against a bundle
    // no build ever produces.
    const bundle = {
      ...cssAsset(
        'components/card/css/card.css',
        '.a{background:url(/assets/icons.svg)}',
      ),
      'assets/icons.svg': {
        type: 'asset',
        fileName: 'assets/icons.svg',
        source: '<svg/>',
      },
    };

    expect(
      runOn(bundle, {
        publishedAssetSources: new Map([
          ['assets/images/x.svg', 'assets/images/x.svg'],
        ]),
      })['components/card/css/card.css'].source,
    ).toBe('.a{background:url(../../../assets/icons.svg)}');
  });

  it.each([
    ['an ambiguous URL', '.a{background:url(/assets/images/dupe.svg)}'],
    ['a missing URL', '.a{background:url(assets/images/gone.svg)}'],
  ])('leaves %s exactly as authored', (_label, source) => {
    // The rebase plugin emits nothing for `ambiguous` or `missing`, so there is
    // no output copy to point at. Rewriting anyway produced a confident path
    // into dist/ that no file occupied, and the build still exited 0 — the
    // reporter's diagnostic was the only account of it.
    expect(
      sourceOf('components/card/css/card.css', source, {
        publishedAssetSources: new Map(),
      }),
    ).toBe(source);
  });

  it('recognizes a publicDir copy that Rollup omits from the bundle', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'emulsify-public-assets-'));
    const publicDir = join(projectDir, 'public');
    mkdirSync(join(publicDir, 'assets'), { recursive: true });
    writeFileSync(join(publicDir, 'assets/public.svg'), '<svg/>');

    const options = {
      build: {
        outDir: join(projectDir, 'dist'),
        copyPublicDir: true,
      },
      config: { publicDir },
      env: { projectDir },
      publishedAssetSources: new Map(),
    };

    try {
      expect(
        sourceOf(
          'assets/site.css',
          '.a{background:url(/assets/public.svg)}',
          options,
        ),
      ).toBe('.a{background:url(public.svg)}');

      expect(
        sourceOf('assets/site.css', '.a{background:url(/assets/public.svg)}', {
          ...options,
          build: { ...options.build, copyPublicDir: false },
        }),
      ).toBe('.a{background:url(/assets/public.svg)}');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('rewrites the bare assets/ form the same way as the root-absolute form', () => {
    // Both forms are documented in docs/asset-references.md, so both have to
    // come out identical.
    const bare = sourceOf(
      'components/card/css/card.css',
      '.a{background:url(assets/images/x.svg)}',
    );
    const absolute = sourceOf(
      'components/card/css/card.css',
      '.a{background:url(/assets/images/x.svg)}',
    );

    expect(bare).toBe(absolute);
  });

  it.each([
    [
      'a block comment',
      `/* background: url(${QUOTE}/assets/x.svg${QUOTE}); */`,
    ],
    ['a trailing line comment', '.a { color: red; } // see url(/assets/x.svg)'],
    [
      'a quoted string value',
      `.a { content: ${DOUBLE_QUOTE}url(/assets/x.svg)${DOUBLE_QUOTE}; }`,
    ],
  ])('ignores url() text inside %s', (_label, css) => {
    expect(sourceOf('components/card/card.css', css)).toBe(css);
  });

  it.each([
    ['unquoted', '', ''],
    ['single quoted', QUOTE, QUOTE],
    ['double quoted', DOUBLE_QUOTE, DOUBLE_QUOTE],
  ])('preserves %s URLs', (_label, open, close) => {
    // Minifiers strip quotes, authored CSS keeps them; both have to survive.
    expect(
      sourceOf(
        'components/card/card.css',
        `.a{background:url(${open}/assets/x.svg${close})}`,
      ),
    ).toBe(`.a{background:url(${open}../../../assets/x.svg${close})}`);
  });

  it.each([
    ['a query', '?v=2'],
    ['a fragment', '#icon'],
    ['a query and fragment', '?v=2#icon'],
    ['a bare query marker', '?'],
    ['a bare fragment marker', '#'],
  ])('preserves %s after the source lookup', (_label, suffix) => {
    expect(
      sourceOf(
        'components/card/card.css',
        `.a{background:url('/assets/x.svg${suffix}')}`,
      ),
    ).toBe(`.a{background:url('../../../assets/x.svg${suffix}')}`);
  });

  it('accepts whitespace around a URL value', () => {
    expect(
      sourceOf(
        'components/card/card.css',
        `.a{background:url( ${QUOTE}/assets/x.svg${QUOTE} )}`,
      ),
    ).toBe(`.a{background:url(${QUOTE}../../../assets/x.svg${QUOTE})}`);
  });

  it('accepts a closing parenthesis inside a quoted URL', () => {
    expect(
      sourceOf(
        'components/card/card.css',
        `.a{background:url(${DOUBLE_QUOTE}/assets/x).svg?v=2${DOUBLE_QUOTE})}`,
        {
          publishedAssetSources: new Map([['assets/x).svg', 'assets/x).svg']]),
        },
      ),
    ).toBe(
      `.a{background:url(${DOUBLE_QUOTE}../../../assets/x).svg?v=2${DOUBLE_QUOTE})}`,
    );
  });

  it('never points published assets into the output directory', () => {
    const output = sourceOf(
      'components/card/card.css',
      [
        `.a{background:url(${QUOTE}/assets/x.svg?v=2${QUOTE})}`,
        `.b{background:url(${QUOTE}/assets/x.svg#icon${QUOTE})}`,
      ].join(''),
      {
        build: { outDir: '/p/release-output' },
        env: {
          projectDir: '/p',
          projectStructure: { mirrorComponentOutput: true },
        },
      },
    );

    expect(output).not.toContain('release-output/');
  });

  it('leaves mismatched quotes alone', () => {
    // The pattern backreferences the opening quote, so a malformed URL is not
    // silently "repaired" into something different.
    const malformed = '.a{background:url(\'/assets/x.svg")}';

    expect(sourceOf('components/card/card.css', malformed)).toBe(malformed);
  });

  it.each([
    ['a relative URL', '.a{background:url(../../assets/images/x.jpg)}'],
    ['a non-asset absolute URL', '.a{background:url(/themes/custom/x.png)}'],
    ['a data URI', '.a{background:url(data:image/svg+xml,%3Csvg%3E)}'],
    ['a lookalike directory', '.a{background:url(/assets2/x.svg)}'],
  ])('leaves %s untouched', (_label, css) => {
    expect(sourceOf('components/card/css/card.css', css)).toBe(css);
  });

  it('does not touch relative URLs, which is why the rebase plugin exists', () => {
    // This is the boundary the whole asset-URL fix turns on. A relative URL is
    // anchored right after `url(`, so the pattern cannot match it, and the URL
    // ships re-anchored to wherever the CSS landed. `css-asset-rebase.js`
    // normalizes those to `/assets/...` before this plugin ever sees them.
    const css = '.a{background:url(../../assets/images/x.jpg)}';

    expect(sourceOf('components/card/css/card.css', css)).toBe(css);
  });

  it('is idempotent', () => {
    // Watch rebuilds and Storybook can run the chain over already-emitted CSS;
    // a second pass must not re-relativize its own output.
    const once = sourceOf(
      'components/card/css/card.css',
      '.a{background:url(/assets/images/x.svg)}',
    );

    expect(sourceOf('components/card/css/card.css', once)).toBe(once);
  });

  it('skips chunks, non-CSS assets, and binary sources', () => {
    const bundle = {
      'app.js': { type: 'chunk', code: 'url(/assets/x.svg)' },
      'assets/x.svg': { type: 'asset', source: 'url(/assets/x.svg)' },
      'style.css': { type: 'asset', source: new Uint8Array([1, 2, 3]) },
    };

    expect(() => runOn(bundle)).not.toThrow();
    expect(bundle['app.js'].code).toBe('url(/assets/x.svg)');
    expect(bundle['assets/x.svg'].source).toBe('url(/assets/x.svg)');
    expect(bundle['style.css'].source).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('honors a custom assets root on the output side', () => {
    expect(
      sourceOf(
        'components/card/card.css',
        '.a{background:url(/assets/x.svg)}',
        {
          assetsRoot: 'static',
        },
      ),
    ).toBe('.a{background:url(../../../static/x.svg)}');
  });
});
