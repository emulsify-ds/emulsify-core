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
import { join } from 'path';

import { resolveProjectConfig } from '../../project-config.js';
import { resolveProjectStructure } from '../../project-structure.js';
import { copyAllSrcAssetsPlugin } from './copy-src-assets.js';
import { copyTwigFilesPlugin } from './copy-twig-files.js';
import { createSourceFileIndex } from './source-file-index.js';
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
    // Emitted from a named structure root too, not only from component roots.
    expect(existsSync(join(outDir, 'foundation/icons/_partial.twig'))).toBe(
      true,
    );
    expect(
      existsSync(join(outDir, 'foundation/icons/icon.component.json')),
    ).toBe(true);
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
      'removes a deleted copied %s on the next cycle',
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

        expect(existsSync(output)).toBe(false);
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
      'replaces a renamed copied %s on the next cycle',
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

        expect(existsSync(join(outputDir, originalName))).toBe(false);
        expect(existsSync(join(outputDir, renamedName))).toBe(true);
        expect(addWatchFile).toHaveBeenCalledWith(renamedSource);
      },
    );

    it('keeps one copy plugin output when the other plugin prunes its own', () => {
      const { structure, outDir } = scaffold();
      const build = { outDir, root: projectDir, watch: {} };
      const twigSource = join(projectDir, 'src/components/card/card.twig');
      const sharedIndex = createSourceFileIndex(structure);
      const plugins = [
        copyTwigFilesPlugin({ structure, sourceFileIndex: sharedIndex }),
        copyAllSrcAssetsPlugin({
          structure,
          sourceFileIndex: sharedIndex,
        }),
      ];
      const runCycle = () => {
        for (const plugin of plugins) {
          plugin.buildStart.call({ addWatchFile: jest.fn() });
        }
        for (const plugin of plugins) plugin.writeBundle();
      };

      for (const plugin of plugins) plugin.configResolved({ build });
      runCycle();
      rmSync(twigSource);
      for (const plugin of plugins) {
        plugin.watchChange(twigSource, { event: 'delete' });
      }
      runCycle();

      expect(existsSync(join(outDir, 'components/card/card.twig'))).toBe(false);
      expect(existsSync(join(outDir, 'components/card/icon.svg'))).toBe(true);
    });

    it.each([
      ['Twig template', copyTwigFilesPlugin, 'card.twig'],
      ['static asset', copyAllSrcAssetsPlugin, 'icon.svg'],
    ])(
      'does not prune a %s destination replaced by another writer',
      (_name, factory, file) => {
        const { structure, outDir } = scaffold();
        const build = { outDir, root: projectDir, watch: {} };
        const source = join(projectDir, 'src/components/card', file);
        const output = join(outDir, 'components/card', file);
        const plugin = factory({ structure });

        plugin.configResolved({ build });
        plugin.writeBundle();
        writeFileSync(output, 'second writer');

        rmSync(source);
        plugin.watchChange(source, { event: 'delete' });
        plugin.writeBundle();

        expect(readFileSync(output, 'utf8')).toBe('second writer');
      },
    );

    it.each([
      ['Twig template', copyTwigFilesPlugin, 'card.twig'],
      ['static asset', copyAllSrcAssetsPlugin, 'icon.svg'],
    ])(
      'retains ownership of an unreadable stale %s output for a later retry',
      (_name, factory, file) => {
        const { structure, outDir } = scaffold();
        const build = { outDir, root: projectDir, watch: {} };
        const source = join(projectDir, 'src/components/card', file);
        const output = join(outDir, 'components/card', file);
        const originalBytes = readFileSync(source);
        const plugin = factory({ structure });
        const warn = jest.fn();

        plugin.configResolved({ build });
        plugin.writeBundle.call({ warn });
        rmSync(source);
        plugin.watchChange(source, { event: 'delete' });

        // A directory is an existing path whose contents cannot be verified as
        // the file this plugin wrote. It stands in for EACCES portably.
        rmSync(output);
        mkdirSync(output);
        plugin.writeBundle.call({ warn });

        expect(existsSync(output)).toBe(true);
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('Unable to verify stale copied output'),
        );

        rmSync(output, { recursive: true });
        writeFileSync(output, originalBytes);
        plugin.writeBundle.call({ warn });

        expect(existsSync(output)).toBe(false);
      },
    );

    it('does not claim or prune an identical output it skipped', () => {
      const { structure, outDir } = scaffold();
      const build = { outDir, root: projectDir, watch: {} };
      const source = join(projectDir, 'src/components/card/card.twig');
      const output = join(outDir, 'components/card/card.twig');
      const plugin = copyTwigFilesPlugin({ structure });

      mkdirSync(join(output, '..'), { recursive: true });
      writeFileSync(output, readFileSync(source));
      plugin.configResolved({ root: projectDir, build });
      plugin.writeBundle();

      // Vite may leave an outside-root output directory intact. Identical bytes
      // from another writer are skipped, so merely seeing this destination in
      // the plan must not make it safe for this plugin to prune later.
      rmSync(source);
      plugin.watchChange(source, { event: 'delete' });
      plugin.writeBundle();

      expect(existsSync(output)).toBe(true);
    });

    it('keeps an owned output when an existing source is missing from a refreshed plan', () => {
      const { structure, outDir } = scaffold();
      const build = { outDir, root: projectDir, watch: {} };
      const source = join(projectDir, 'src/components/card/card.twig');
      const output = join(outDir, 'components/card/card.twig');
      const realIndex = createSourceFileIndex(structure);
      let hideIndexedFiles = false;
      const sourceFileIndex = {
        componentFiles: () =>
          hideIndexedFiles ? [] : realIndex.componentFiles(),
        globalFiles: () => (hideIndexedFiles ? [] : realIndex.globalFiles()),
        refresh: () => realIndex.refresh(),
      };
      const plugin = copyTwigFilesPlugin({ structure, sourceFileIndex });

      plugin.configResolved({ build });
      plugin.writeBundle();
      hideIndexedFiles = true;
      plugin.watchChange(source, { event: 'delete' });
      plugin.writeBundle();

      expect(existsSync(source)).toBe(true);
      expect(existsSync(output)).toBe(true);
    });

    it('claims a pre-existing mirrored output during the first cycle', () => {
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
      expect(existsSync(transientOutput)).toBe(true);

      // The mirror plugin drops the transient copy when its bytes already
      // match, leaving the existing final file and its mtime alone.
      rmSync(transientOutput);
      expect(statSync(mirroredOutput).mtimeMs).toBe(1000);

      rmSync(source);
      plugin.watchChange(source, { event: 'delete' });
      plugin.writeBundle();

      expect(existsSync(mirroredOutput)).toBe(false);
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
