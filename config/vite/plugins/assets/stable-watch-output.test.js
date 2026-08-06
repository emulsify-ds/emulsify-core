/**
 * @file Tests for stable watch output.
 *
 * Two behaviors, and the fix is only correct with both. Vite empties the whole
 * output directory on every watch rebuild, so a plugin comparing against the
 * previous file finds nothing and can never skip; and Rollup rewrites every
 * asset each cycle, so leaving the directory alone by itself changes nothing.
 * These pin the pair.
 */

import { mkdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

import { makeTempProject } from '../../test-utils/plugins.js';
import { stableWatchOutputPlugin } from './stable-watch-output.js';

/**
 * Write a file, creating its parent directories.
 *
 * @param {string} filePath - Absolute file path.
 * @param {string} contents - File contents.
 */
const write = (filePath, contents) => {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents);
};

/**
 * Build a minimal CSS asset entry.
 *
 * @param {string} source - Stylesheet text.
 * @returns {object} Rollup asset shape.
 */
const asset = (source) => ({ type: 'asset', source });

/**
 * Drive the plugin through one watch cycle.
 *
 * @param {object} plugin - Plugin under test.
 * @param {object} bundle - Bundle to reduce.
 * @param {object} [environment] - Plugin context environment.
 * @returns {object} The same bundle object, after reduction.
 */
const cycle = (plugin, bundle, environment) => {
  const context = { environment };

  plugin.buildStart.call(context);
  plugin.renderStart.call(context);
  plugin.generateBundle.call(context, {}, bundle);

  return bundle;
};

describe('stableWatchOutputPlugin', () => {
  /**
   * Create a plugin bound to a fresh temporary project.
   *
   * @param {object} [opts={}] - Plugin options.
   * @returns {{plugin: object, projectDir: string, outDir: string, unchangedOutputs: Set<string>}} Harness.
   */
  const harness = (opts = {}) => {
    const projectDir = makeTempProject();
    const outDir = join(projectDir, 'dist');
    const unchangedOutputs = new Set();
    const plugin = stableWatchOutputPlugin({
      projectDir,
      unchangedOutputs,
      ...opts,
    });

    plugin.configResolved({ build: { outDir: 'dist', watch: {} } });

    return { plugin, projectDir, outDir, unchangedOutputs };
  };

  it('drops a stylesheet whose bytes are already on disk', () => {
    const { plugin, outDir, unchangedOutputs } = harness();
    write(join(outDir, 'global/base/css/base.css'), '.base{color:red}');

    const bundle = cycle(plugin, {
      'global/base/css/base.css': asset('.base{color:red}'),
    });

    expect(Object.keys(bundle)).toEqual([]);
    expect([...unchangedOutputs]).toEqual(['global/base/css/base.css']);
  });

  it('keeps the stylesheet the edit actually changed', () => {
    // The whole point: one edit must produce exactly one rewritten file.
    const { plugin, outDir } = harness();
    write(join(outDir, 'components/card/css/card.css'), '.card{color:red}');
    write(join(outDir, 'global/base/css/base.css'), '.base{color:red}');

    const bundle = cycle(plugin, {
      'components/card/css/card.css': asset('.card{color:blue}'),
      'global/base/css/base.css': asset('.base{color:red}'),
    });

    expect(Object.keys(bundle)).toEqual(['components/card/css/card.css']);
  });

  it('writes everything on the first cycle', () => {
    const { plugin } = harness();

    const bundle = cycle(plugin, {
      'global/base/css/base.css': asset('.base{color:red}'),
    });

    expect(Object.keys(bundle)).toEqual(['global/base/css/base.css']);
  });

  it('compares mirrored components against the mirror destination', () => {
    const { plugin, projectDir } = harness({ mirrorComponentOutput: true });
    write(join(projectDir, 'components/card/css/card.css'), '.card{color:red}');

    const bundle = cycle(plugin, {
      'components/card/css/card.css': asset('.card{color:red}'),
    });

    expect(Object.keys(bundle)).toEqual([]);
  });

  it('skips any unchanged asset, not only stylesheets', () => {
    // The icon sprite is rebuilt every cycle too, and it is an asset like any
    // other. Chunks are excluded: they travel with a sourcemap and a hashed
    // name graph, and nothing in the preview enumerates them by glob.
    const { plugin, outDir } = harness();
    write(join(outDir, 'icons/icons.svg'), '<svg/>');
    write(join(outDir, 'card.js'), 'export default 1;');

    const bundle = cycle(plugin, {
      'icons/icons.svg': asset('<svg/>'),
      'card.js': { type: 'chunk', code: 'export default 1;' },
    });

    expect(Object.keys(bundle)).toEqual(['card.js']);
  });

  it('writes every file for a one-shot build', () => {
    // A release build starts from an emptied directory and must stay byte for
    // byte identical, so the skip never applies there.
    const projectDir = makeTempProject();
    const outDir = join(projectDir, 'dist');
    const plugin = stableWatchOutputPlugin({ projectDir });

    plugin.configResolved({ build: { outDir: 'dist' } });
    write(join(outDir, 'global/base/css/base.css'), '.base{color:red}');

    const bundle = cycle(plugin, {
      'global/base/css/base.css': asset('.base{color:red}'),
    });

    expect(Object.keys(bundle)).toEqual(['global/base/css/base.css']);
  });

  it('reports only the current cycle as unchanged', () => {
    const { plugin, outDir, unchangedOutputs } = harness();
    write(join(outDir, 'global/base/css/base.css'), '.base{color:red}');

    cycle(plugin, { 'global/base/css/base.css': asset('.base{color:red}') });
    cycle(plugin, { 'global/base/css/base.css': asset('.base{color:blue}') });

    expect([...unchangedOutputs]).toEqual([]);
  });

  it('stops Vite emptying the output directory after the first cycle', () => {
    // Without this the skip above can never match: Vite deletes the whole tree
    // at the start of every rebuild, so nothing is left to compare against.
    const { plugin } = harness();
    const environment = { config: { build: { emptyOutDir: true } } };

    plugin.renderStart.call({ environment });

    expect(environment.config.build.emptyOutDir).toBe(false);
  });

  it('leaves emptying alone for a one-shot build', () => {
    const projectDir = makeTempProject();
    const plugin = stableWatchOutputPlugin({ projectDir });
    const environment = { config: { build: { emptyOutDir: true } } };

    plugin.configResolved({ build: { outDir: 'dist' } });
    plugin.renderStart.call({ environment });

    expect(environment.config.build.emptyOutDir).toBe(true);
  });

  it('does not touch the file it skipped', () => {
    // mtime is what a watcher acts on, so assert on mtime rather than content.
    const { plugin, outDir } = harness();
    const file = join(outDir, 'global/base/css/base.css');
    write(file, '.base{color:red}');
    const before = statSync(file).mtimeMs;

    cycle(plugin, { 'global/base/css/base.css': asset('.base{color:red}') });

    expect(statSync(file).mtimeMs).toBe(before);
  });
});
