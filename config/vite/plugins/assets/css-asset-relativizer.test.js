/**
 * @file Tests for the CSS asset URL relativizer.
 *
 * The relativizer decides the path every emitted stylesheet uses to reach a
 * project asset, and that path differs per project shape. Nothing pinned it
 * before this file, which is why the shape-dependent breakage it half-covers
 * went unnoticed.
 */

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

const runOn = (bundle, { build = { outDir: 'dist' }, ...opts } = {}) => {
  const plugin = cssAssetUrlRelativizer({
    env: { projectDir: '/p' },
    publishedAssetSources: DEFAULT_SOURCES,
    ...opts,
  });
  plugin.configResolved({ build });
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
    // /assets, so reaching outside that output would break the mount.
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
    // must stay output-relative.
    expect(
      sourceOf(
        'components/card/css/card.css',
        '.a{background:url(/assets/icons.svg)}',
        {
          publishedAssetSources: new Map([
            ['assets/images/x.svg', 'assets/images/x.svg'],
          ]),
        },
      ),
    ).toBe('.a{background:url(../../../assets/icons.svg)}');
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
