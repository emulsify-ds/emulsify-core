/**
 * @file Tests for source Twig, metadata, and static asset copy plugins.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';

import { resolveProjectConfig } from '../../project-config.js';
import { resolveProjectStructure } from '../../project-structure.js';
import { copyAllSrcAssetsPlugin } from './copy-src-assets.js';
import { copyTwigFilesPlugin } from './copy-twig-files.js';
import {
  makeEnv,
  makeTempProject,
  writeProjectConfig,
} from '../../test-utils/plugins.js';

describe('source copy plugins', () => {
  let projectDir;

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  const runCopyPlugins = (structure, outDir) => {
    const copyTwigPlugin = copyTwigFilesPlugin({ structure });
    const copyAssetsPlugin = copyAllSrcAssetsPlugin({ structure });

    copyTwigPlugin.configResolved({ build: { outDir } });
    copyAssetsPlugin.configResolved({ build: { outDir } });
    copyTwigPlugin.writeBundle();
    copyAssetsPlugin.writeBundle();
  };

  it('copies static assets from root component directories to dist/components', () => {
    projectDir = makeTempProject();
    const componentDir = join(projectDir, 'components/card');
    const outDir = join(projectDir, 'dist');
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(join(componentDir, 'card.twig'), '<article></article>');
    writeFileSync(join(componentDir, '_partial.twig'), '<span></span>');
    writeFileSync(join(componentDir, 'card.component.yml'), 'name: Card');
    writeFileSync(join(componentDir, 'image.png'), 'image');
    writeFileSync(join(componentDir, 'data.json'), '{"fixture":true}');
    writeFileSync(join(componentDir, 'card.js'), 'console.log("skip");');
    writeFileSync(join(componentDir, 'Card.jsx'), 'export function Card() {}');
    writeFileSync(join(componentDir, 'card.scss'), '.skip {}');
    writeFileSync(join(componentDir, 'Card.php'), '<?php class Card {}');

    const structure = resolveProjectStructure(
      makeEnv(projectDir, {
        srcDir: join(projectDir, 'components'),
        srcExists: false,
      }),
    );

    runCopyPlugins(structure, outDir);

    expect(existsSync(join(outDir, 'components/card/card.twig'))).toBe(true);
    // An underscored Twig template is still included at render time, so it has to
    // be emitted. Only stylesheets treat the prefix as "no output of its own".
    expect(existsSync(join(outDir, 'components/card/_partial.twig'))).toBe(
      true,
    );
    expect(existsSync(join(outDir, 'components/card/card.component.yml'))).toBe(
      true,
    );
    expect(existsSync(join(outDir, 'components/card/image.png'))).toBe(true);
    expect(existsSync(join(outDir, 'components/card/data.json'))).toBe(true);
    expect(existsSync(join(outDir, 'components/card/card.js'))).toBe(false);
    expect(existsSync(join(outDir, 'components/card/Card.jsx'))).toBe(false);
    expect(existsSync(join(outDir, 'components/card/card.scss'))).toBe(false);
    expect(existsSync(join(outDir, 'components/card/Card.php'))).toBe(false);
  });

  it('records only copied files whose bytes were written this cycle', () => {
    projectDir = makeTempProject();
    const componentDir = join(projectDir, 'src/components/card');
    const outDir = join(projectDir, 'dist');
    const outputChanges = new Map();
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(join(componentDir, 'card.twig'), '<article></article>');
    writeFileSync(join(componentDir, 'card.component.yml'), 'name: Card');
    writeFileSync(join(componentDir, 'icon.svg'), '<svg />');

    const structure = resolveProjectStructure(makeEnv(projectDir));
    const plugins = [
      copyTwigFilesPlugin({ structure, outputChanges }),
      copyAllSrcAssetsPlugin({ structure, outputChanges }),
    ];
    for (const plugin of plugins) {
      plugin.configResolved({ root: projectDir, build: { outDir, watch: {} } });
      plugin.writeBundle();
    }

    expect(Object.fromEntries(outputChanges)).toEqual({
      'components/card/card.component.yml': {
        kind: 'written',
        bytes: Buffer.byteLength('name: Card'),
      },
      'components/card/card.twig': {
        kind: 'written',
        bytes: Buffer.byteLength('<article></article>'),
      },
      'components/card/icon.svg': {
        kind: 'written',
        bytes: Buffer.byteLength('<svg />'),
      },
    });

    outputChanges.clear();
    for (const plugin of plugins) plugin.writeBundle();

    expect(outputChanges.size).toBe(0);

    // One-shot builds do not render cycle diffs, so they should not pay to
    // collect reporting metadata even though they rewrite every copied file.
    for (const plugin of plugins) {
      plugin.configResolved({ root: projectDir, build: { outDir } });
      plugin.writeBundle();
    }
    expect(outputChanges.size).toBe(0);
  });

  it('copies assets from named structure roots to matching dist folders', () => {
    projectDir = makeTempProject();
    const outDir = join(projectDir, 'dist');
    writeProjectConfig(projectDir, {
      project: {
        platform: 'none',
      },
      variant: {
        structureImplementations: [
          { name: 'components', directory: './src/components/' },
          { name: 'foundation', directory: './src/foundation/' },
        ],
      },
    });
    mkdirSync(join(projectDir, 'src/components/card'), { recursive: true });
    mkdirSync(join(projectDir, 'src/foundation/icons'), { recursive: true });
    writeFileSync(
      join(projectDir, 'src/components/card/card.twig'),
      '<article></article>',
    );
    writeFileSync(
      join(projectDir, 'src/components/card/_partial.twig'),
      '<span></span>',
    );
    writeFileSync(
      join(projectDir, 'src/components/card/card.component.yml'),
      'name: Card',
    );
    writeFileSync(join(projectDir, 'src/components/card/image.png'), 'image');
    writeFileSync(join(projectDir, 'src/foundation/icons/icon.svg'), '<svg />');
    writeFileSync(
      join(projectDir, 'src/foundation/icons/Icon.php'),
      '<?php class Icon {}',
    );
    writeFileSync(
      join(projectDir, 'src/foundation/icons/_partial.twig'),
      '<span></span>',
    );
    writeFileSync(
      join(projectDir, 'src/foundation/icons/icon.component.json'),
      '{"name":"Icon"}',
    );

    runCopyPlugins(
      resolveProjectConfig(projectDir, {}).projectStructure,
      outDir,
    );

    expect(existsSync(join(outDir, 'components/card/card.twig'))).toBe(true);
    expect(existsSync(join(outDir, 'components/card/_partial.twig'))).toBe(
      true,
    );
    expect(existsSync(join(outDir, 'components/card/card.component.yml'))).toBe(
      true,
    );
    expect(existsSync(join(outDir, 'components/card/image.png'))).toBe(true);
    expect(existsSync(join(outDir, 'foundation/icons/icon.svg'))).toBe(true);
    expect(existsSync(join(outDir, 'foundation/icons/Icon.php'))).toBe(false);
    // Emitted from a named structure root too, not only from component roots.
    expect(existsSync(join(outDir, 'foundation/icons/_partial.twig'))).toBe(
      true,
    );
    expect(
      existsSync(join(outDir, 'foundation/icons/icon.component.json')),
    ).toBe(true);
  });

  it('rejects path-like structure names before a copy can escape outDir', () => {
    projectDir = makeTempProject();
    const nestedProjectDir = join(projectDir, 'project');
    const source = join(nestedProjectDir, 'src/foundation/icons/icon.svg');
    const outDir = join(nestedProjectDir, 'dist');
    const outsideFile = join(projectDir, 'escape-target/icons/icon.svg');
    const outsideBytes = 'hand-authored outside file';

    mkdirSync(join(source, '..'), { recursive: true });
    mkdirSync(join(outsideFile, '..'), { recursive: true });
    writeFileSync(source, '<svg />');
    writeFileSync(outsideFile, outsideBytes);
    writeProjectConfig(nestedProjectDir, {
      project: {
        platform: 'none',
      },
      variant: {
        structureImplementations: [
          {
            name: '../../escape-target',
            directory: './src/foundation/',
          },
        ],
      },
    });

    const runCycle = () => {
      const structure = resolveProjectConfig(
        nestedProjectDir,
        {},
      ).projectStructure;
      const plugin = copyAllSrcAssetsPlugin({ structure });
      plugin.configResolved({
        root: nestedProjectDir,
        build: { outDir, watch: {} },
      });
      plugin.writeBundle();
    };

    expect(runCycle).toThrow('expected a single path segment');
    expect(readFileSync(outsideFile, 'utf8')).toBe(outsideBytes);

    rmSync(source);
    expect(runCycle).toThrow('expected a single path segment');
    expect(existsSync(outsideFile)).toBe(true);
    expect(readFileSync(outsideFile, 'utf8')).toBe(outsideBytes);
  });

  describe('watching what it copies', () => {
    /**
     * Build a project with one of everything the copy plugins handle.
     *
     * @returns {{structure: object, outDir: string}} Resolved project.
     */
    const scaffold = () => {
      projectDir = makeTempProject();
      const componentDir = join(projectDir, 'src/components/card');
      mkdirSync(componentDir, { recursive: true });
      writeFileSync(join(componentDir, 'card.twig'), '<article></article>');
      writeFileSync(join(componentDir, '_partial.twig'), '<span></span>');
      writeFileSync(join(componentDir, 'card.component.yml'), 'name: Card');
      writeFileSync(join(componentDir, 'icon.svg'), '<svg/>');
      writeFileSync(join(componentDir, 'card.scss'), '.card {}');

      return {
        structure: resolveProjectStructure(makeEnv(projectDir)),
        outDir: join(projectDir, 'dist'),
      };
    };

    /**
     * Collect the paths a plugin registers with the watcher.
     *
     * @param {object} plugin - Copy plugin.
     * @param {object} build - Resolved `build` config.
     * @returns {string[]} Registered paths.
     */
    const watchedBy = (plugin, build) => {
      const addWatchFile = jest.fn();
      plugin.configResolved({ build });
      plugin.buildStart?.call({ addWatchFile });

      return addWatchFile.mock.calls.map(([path]) => path);
    };

    it('leaves PHP in source without copying it or watching it for rebuilds', () => {
      const { structure, outDir } = scaffold();
      const phpFiles = [
        'src/Hook/PageTitleHooks.php',
        'src/Plugin/Block/ExampleBlock.php',
        'src/components/card/Card.PHP',
        'src/mixed/Helper.php',
      ];
      for (const file of phpFiles) {
        const source = join(projectDir, file);
        mkdirSync(dirname(source), { recursive: true });
        writeFileSync(source, '<?php // Server-side source.');
      }
      const mixedAsset = join(projectDir, 'src/mixed/icon.svg');
      writeFileSync(mixedAsset, '<svg />');
      const watched = [];

      for (const factory of [copyTwigFilesPlugin, copyAllSrcAssetsPlugin]) {
        const plugin = factory({ structure });
        watched.push(...watchedBy(plugin, { outDir, watch: {} }));
        plugin.writeBundle();
      }

      for (const file of phpFiles) {
        expect(watched).not.toContain(join(projectDir, file));
        expect(readFileSync(join(projectDir, file), 'utf8')).toBe(
          '<?php // Server-side source.',
        );
      }
      expect(existsSync(join(outDir, 'global/Hook'))).toBe(false);
      expect(existsSync(join(outDir, 'global/Plugin'))).toBe(false);
      expect(existsSync(join(outDir, 'components/card/Card.PHP'))).toBe(false);
      expect(existsSync(join(outDir, 'global/mixed/Helper.php'))).toBe(false);
      expect(watched).toContain(mixedAsset);
      expect(readFileSync(join(outDir, 'global/mixed/icon.svg'), 'utf8')).toBe(
        '<svg />',
      );
      expect(existsSync(join(outDir, 'components/card/card.twig'))).toBe(true);
      expect(
        existsSync(join(outDir, 'components/card/card.component.yml')),
      ).toBe(true);
    });

    it.each([
      'module',
      'theme',
      'inc',
      'install',
      'profile',
      'engine',
      'phtml',
      'php5',
      'PHP8',
      'mjs',
      'cjs',
      'ts',
      'tsx',
      'mts',
      'cts',
      'mtsx',
      'ctsx',
    ])(
      'leaves .%s source out of copied output and watch paths',
      (extension) => {
        const { structure, outDir } = scaffold();
        const sourceFiles = [
          ['src/components/card', 'components/card'],
          ['src/mixed', 'global/mixed'],
        ].map(([sourceDir, outputDir]) => {
          const source = join(projectDir, sourceDir, `source.${extension}`);
          mkdirSync(dirname(source), { recursive: true });
          writeFileSync(source, 'source stays private to the build');
          return [source, join(outDir, outputDir, `source.${extension}`)];
        });
        const plugin = copyAllSrcAssetsPlugin({ structure });
        const watched = watchedBy(plugin, { outDir, watch: {} });
        plugin.writeBundle();

        for (const [source, output] of sourceFiles) {
          expect(watched).not.toContain(source);
          expect(existsSync(output)).toBe(false);
          expect(readFileSync(source, 'utf8')).toBe(
            'source stays private to the build',
          );
        }
      },
    );

    it('continues copying arbitrary non-code asset types', () => {
      const { structure, outDir } = scaffold();
      const extensions = [
        'css',
        'woff2',
        'pdf',
        'xml',
        'wasm',
        'webmanifest',
        'custom-asset',
      ];
      for (const extension of extensions) {
        writeFileSync(
          join(projectDir, 'src/components/card', `asset.${extension}`),
          `fixture ${extension}`,
        );
      }
      const plugin = copyAllSrcAssetsPlugin({ structure });
      const watched = watchedBy(plugin, { outDir, watch: {} });
      plugin.writeBundle();

      for (const extension of extensions) {
        expect(watched).toContain(
          join(projectDir, 'src/components/card', `asset.${extension}`),
        );
        expect(
          readFileSync(
            join(outDir, 'components/card', `asset.${extension}`),
            'utf8',
          ),
        ).toBe(`fixture ${extension}`);
      }
    });

    it('watches every template and asset it will copy', () => {
      // Twig and static assets are copied rather than compiled, so none of them
      // reach Rollup's module graph and nothing else would watch them. Saving a
      // template produced no rebuild at all, which left dist/ holding the
      // previous version until an unrelated stylesheet changed.
      const { structure, outDir } = scaffold();
      const build = { outDir, watch: {} };

      const twigWatched = watchedBy(copyTwigFilesPlugin({ structure }), build);
      const assetWatched = watchedBy(
        copyAllSrcAssetsPlugin({ structure }),
        build,
      );
      const watched = [...twigWatched, ...assetWatched].map((path) =>
        path.replace(`${projectDir}/`, ''),
      );

      expect(watched).toContain('src/components/card/card.twig');
      expect(watched).toContain('src/components/card/card.component.yml');
      expect(watched).toContain('src/components/card/icon.svg');
    });

    it('watches exactly what it copies and nothing else', () => {
      // The two hooks read one shared plan, so this holds by construction. The
      // assertion is here to keep it that way: a file copied but not watched is
      // stale output, and a file watched but not copied is a pointless rebuild.
      const { structure, outDir } = scaffold();
      const build = { outDir, watch: {} };

      for (const factory of [copyTwigFilesPlugin, copyAllSrcAssetsPlugin]) {
        const plugin = factory({ structure });
        const watched = watchedBy(plugin, build);

        plugin.writeBundle();

        const copied = watched.filter((absPath) =>
          existsSync(join(outDir, absPath.replace(`${projectDir}/src/`, ''))),
        );

        expect(watched.length).toBeGreaterThan(0);
        expect(copied.length).toBe(watched.length);
      }
    });

    it('watches an underscored template and leaves compiled entries alone', () => {
      // The plan drives both hooks, so a template that is now copied is also now
      // watched — saving it has to update dist/ like any other template. SCSS
      // stays out because Rollup already watches what it compiles.
      const { structure, outDir } = scaffold();
      const watched = [
        ...watchedBy(copyTwigFilesPlugin({ structure }), {
          outDir,
          watch: {},
        }),
        ...watchedBy(copyAllSrcAssetsPlugin({ structure }), {
          outDir,
          watch: {},
        }),
      ];

      expect(watched.some((path) => path.endsWith('_partial.twig'))).toBe(true);
      expect(watched.some((path) => path.endsWith('card.scss'))).toBe(false);
    });

    it('registers nothing for a one-shot build', () => {
      // `npm run build`, `storybook build`, and the release fixtures all resolve
      // without `build.watch`, and their behavior must not change.
      const { structure, outDir } = scaffold();
      const build = { outDir };

      expect(watchedBy(copyTwigFilesPlugin({ structure }), build)).toEqual([]);
      expect(watchedBy(copyAllSrcAssetsPlugin({ structure }), build)).toEqual(
        [],
      );
    });

    it('requires a watcher restart to discover new files and component directories', () => {
      const { structure, outDir } = scaffold();
      const build = { outDir, root: projectDir, watch: {} };
      const existingSource = join(projectDir, 'src/components/card/extra.twig');
      const newComponentSource = join(
        projectDir,
        'src/components/badge/badge.twig',
      );
      const existingOutput = join(outDir, 'components/card/extra.twig');
      const newComponentOutput = join(outDir, 'components/badge/badge.twig');
      const plugin = copyTwigFilesPlugin({ structure });
      const addWatchFile = jest.fn();
      const runCycle = (currentPlugin) => {
        currentPlugin.buildStart.call({ addWatchFile });
        currentPlugin.writeBundle();
      };

      plugin.configResolved({ root: projectDir, build });
      runCycle(plugin);

      writeFileSync(existingSource, '<aside>extra</aside>');
      mkdirSync(join(newComponentSource, '..'), { recursive: true });
      writeFileSync(newComponentSource, '<strong>badge</strong>');

      // Neither new path is registered, so the real watcher emits no
      // watchChange event. Even an unrelated cycle keeps using the cached plan.
      addWatchFile.mockClear();
      runCycle(plugin);

      expect(addWatchFile).not.toHaveBeenCalledWith(existingSource);
      expect(addWatchFile).not.toHaveBeenCalledWith(newComponentSource);
      expect(existsSync(existingOutput)).toBe(false);
      expect(existsSync(newComponentOutput)).toBe(false);

      const restartedPlugin = copyTwigFilesPlugin({ structure });
      addWatchFile.mockClear();
      restartedPlugin.configResolved({ root: projectDir, build });
      runCycle(restartedPlugin);

      expect(addWatchFile).toHaveBeenCalledWith(existingSource);
      expect(addWatchFile).toHaveBeenCalledWith(newComponentSource);
      expect(existsSync(existingOutput)).toBe(true);
      expect(existsSync(newComponentOutput)).toBe(true);
    });

    it('requires a watcher restart to discover a renamed component directory', () => {
      const { structure, outDir } = scaffold();
      const build = { outDir, root: projectDir, watch: {} };
      const originalDir = join(projectDir, 'src/components/card');
      const renamedDir = join(projectDir, 'src/components/kard');
      const renamedSource = join(renamedDir, 'card.twig');
      const renamedOutput = join(outDir, 'components/kard/card.twig');
      const plugin = copyTwigFilesPlugin({ structure });
      const addWatchFile = jest.fn();
      const runCycle = (currentPlugin) => {
        currentPlugin.buildStart.call({ addWatchFile });
        currentPlugin.writeBundle();
      };

      plugin.configResolved({ root: projectDir, build });
      runCycle(plugin);
      renameSync(originalDir, renamedDir);

      // A directory rename does not emit a structural event for the individual
      // paths in the cached plan. An unrelated cycle therefore keeps the old
      // paths and cannot discover the renamed tree.
      addWatchFile.mockClear();
      runCycle(plugin);

      expect(addWatchFile).not.toHaveBeenCalledWith(renamedSource);
      expect(existsSync(renamedOutput)).toBe(false);

      const restartedPlugin = copyTwigFilesPlugin({ structure });
      addWatchFile.mockClear();
      restartedPlugin.configResolved({ root: projectDir, build });
      runCycle(restartedPlugin);

      expect(addWatchFile).toHaveBeenCalledWith(renamedSource);
      expect(existsSync(renamedOutput)).toBe(true);
    });

    it('picks up an edit on the next cycle', () => {
      const { structure, outDir } = scaffold();
      const build = { outDir, watch: {} };
      const source = join(projectDir, 'src/components/card/card.twig');
      const twigPath = join(outDir, 'components/card/card.twig');

      const plugin = copyTwigFilesPlugin({ structure });
      plugin.configResolved({ build });
      plugin.writeBundle();

      writeFileSync(source, '<article>edited</article>');
      plugin.writeBundle();

      expect(readFileSync(twigPath, 'utf8')).toBe('<article>edited</article>');
    });

    it('still copies everything when watching', () => {
      // The refactor moved copying onto a shared plan; this pins that a watch
      // build emits the same files a one-shot build does.
      const { structure, outDir } = scaffold();
      const build = { outDir, watch: {} };

      for (const factory of [copyTwigFilesPlugin, copyAllSrcAssetsPlugin]) {
        const plugin = factory({ structure });
        plugin.configResolved({ build });
        plugin.buildStart?.call({ addWatchFile: jest.fn() });
        plugin.writeBundle();
      }

      expect(existsSync(join(outDir, 'components/card/card.twig'))).toBe(true);
      expect(existsSync(join(outDir, 'components/card/icon.svg'))).toBe(true);
      expect(existsSync(join(outDir, 'components/card/_partial.twig'))).toBe(
        true,
      );
    });

    it('does not rewrite a file whose bytes did not change', () => {
      // A rewritten template in the output tree makes the Twig plugin send a
      // full preview reload, which is the flash a stylesheet edit used to
      // cause. mtime is what a watcher acts on, so assert on mtime.
      const { structure, outDir } = scaffold();
      const build = { outDir, root: projectDir, watch: {} };
      const twigPath = join(outDir, 'components/card/card.twig');
      const svgPath = join(outDir, 'components/card/icon.svg');
      const plugins = [
        copyTwigFilesPlugin({ structure }),
        copyAllSrcAssetsPlugin({ structure }),
      ];
      for (const plugin of plugins) plugin.configResolved({ build });

      const runCycle = () => {
        for (const plugin of plugins) plugin.writeBundle();
      };

      runCycle();
      const stamp = new Date(1000);
      utimesSync(twigPath, stamp, stamp);
      utimesSync(svgPath, stamp, stamp);

      runCycle();

      expect(statSync(twigPath).mtimeMs).toBe(1000);
      expect(statSync(svgPath).mtimeMs).toBe(1000);
    });

    it('copies unconditionally for a one-shot build', () => {
      // A release build starts from an emptied output directory, so the check
      // would never match; keeping it off leaves that path exactly as it was.
      const { structure, outDir } = scaffold();
      const build = { outDir, root: projectDir };
      const twigPath = join(outDir, 'components/card/card.twig');

      const runCycle = () => {
        const plugin = copyTwigFilesPlugin({ structure });
        plugin.configResolved({ build });
        plugin.writeBundle();
      };

      runCycle();
      const stamp = new Date(1000);
      utimesSync(twigPath, stamp, stamp);

      runCycle();

      expect(statSync(twigPath).mtimeMs).not.toBe(1000);
    });

    it.each([
      ['Twig template', copyTwigFilesPlugin, 'card.twig'],
      ['component metadata file', copyTwigFilesPlugin, 'card.component.yml'],
      ['static asset', copyAllSrcAssetsPlugin, 'icon.svg'],
    ])(
      'leaves a deleted copied %s after the watch cycle',
      (_name, factory, file) => {
        const { structure, outDir } = scaffold();
        const build = { outDir, root: projectDir, watch: {} };
        const source = join(projectDir, 'src/components/card', file);
        const output = join(outDir, 'components/card', file);
        const plugin = factory({ structure });
        const runCycle = () => {
          plugin.buildStart.call({ addWatchFile: jest.fn() });
          plugin.writeBundle();
        };

        plugin.configResolved({ build });
        runCycle();
        rmSync(source);
        plugin.watchChange(source, { event: 'delete' });
        runCycle();

        expect(existsSync(output)).toBe(true);
      },
    );

    it.each([
      ['Twig template', copyTwigFilesPlugin, 'card.twig', 'renamed.twig'],
      [
        'component metadata file',
        copyTwigFilesPlugin,
        'card.component.yml',
        'renamed.component.yml',
      ],
      ['static asset', copyAllSrcAssetsPlugin, 'icon.svg', 'renamed.svg'],
    ])(
      'copies a renamed %s without pruning its previous output',
      (_name, factory, originalName, renamedName) => {
        const { structure, outDir } = scaffold();
        const build = { outDir, root: projectDir, watch: {} };
        const sourceDir = join(projectDir, 'src/components/card');
        const outputDir = join(outDir, 'components/card');
        const originalSource = join(sourceDir, originalName);
        const renamedSource = join(sourceDir, renamedName);
        const plugin = factory({ structure });
        const addWatchFile = jest.fn();
        const runCycle = () => {
          addWatchFile.mockClear();
          plugin.buildStart.call({ addWatchFile });
          plugin.writeBundle();
        };

        plugin.configResolved({ build });
        runCycle();
        renameSync(originalSource, renamedSource);
        plugin.watchChange(originalSource, { event: 'delete' });
        runCycle();

        expect(existsSync(join(outputDir, originalName))).toBe(true);
        expect(existsSync(join(outputDir, renamedName))).toBe(true);
        expect(addWatchFile).toHaveBeenCalledWith(renamedSource);
      },
    );

    it('skips an identical mirrored output during the first watch cycle', () => {
      const scaffolded = scaffold();
      const structure = {
        ...scaffolded.structure,
        mirrorComponentOutput: true,
      };
      const { outDir } = scaffolded;
      const build = { outDir, root: projectDir, watch: {} };
      const source = join(projectDir, 'src/components/card/card.twig');
      const transientOutput = join(outDir, 'components/card/card.twig');
      const mirroredOutput = join(projectDir, 'components/card/card.twig');
      mkdirSync(join(mirroredOutput, '..'), { recursive: true });
      writeFileSync(mirroredOutput, readFileSync(source));
      const stamp = new Date(1000);
      utimesSync(mirroredOutput, stamp, stamp);
      const plugin = copyTwigFilesPlugin({ structure });

      plugin.configResolved({ root: projectDir, build });
      plugin.writeBundle();
      expect(existsSync(transientOutput)).toBe(false);
      expect(statSync(mirroredOutput).mtimeMs).toBe(1000);
    });
  });

  describe('underscored templates', () => {
    it('emits an underscored template so a runtime include can resolve it', () => {
      // The bug this covers: `{% include '@components/card/_inner.twig' %}` is
      // resolved by Twig at render time against the emitted tree, so a template
      // left out of dist/ is a 404 on the rendered page. Nothing about the
      // filename makes it inlinable the way a Sass partial is.
      projectDir = makeTempProject();
      const componentDir = join(projectDir, 'src/components/card');
      const outDir = join(projectDir, 'dist');
      mkdirSync(componentDir, { recursive: true });
      writeFileSync(
        join(componentDir, 'card.twig'),
        '<div>{% include "@components/card/_inner.twig" %}</div>',
      );
      writeFileSync(join(componentDir, '_inner.twig'), '<span></span>');
      writeFileSync(join(componentDir, '_inner.scss'), '.inner {}');

      runCopyPlugins(resolveProjectStructure(makeEnv(projectDir)), outDir);

      expect(existsSync(join(outDir, 'components/card/_inner.twig'))).toBe(
        true,
      );
      // The Sass partial keeps its exclusion; it has no output of its own.
      expect(existsSync(join(outDir, 'components/card/_inner.scss'))).toBe(
        false,
      );
    });

    it('emits an underscored template from a global root', () => {
      projectDir = makeTempProject();
      const globalDir = join(projectDir, 'src/layout');
      const outDir = join(projectDir, 'dist');
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(join(globalDir, '_grid.twig'), '<div class="grid"></div>');

      runCopyPlugins(resolveProjectStructure(makeEnv(projectDir)), outDir);

      expect(existsSync(join(outDir, 'global/layout/_grid.twig'))).toBe(true);
    });
  });
});
