/**
 * @file Tests for source Twig, metadata, and static asset copy plugins.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

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

    const structure = resolveProjectStructure(
      makeEnv(projectDir, {
        srcDir: join(projectDir, 'components'),
        srcExists: false,
      }),
    );

    runCopyPlugins(structure, outDir);

    expect(existsSync(join(outDir, 'components/card/card.twig'))).toBe(true);
    expect(existsSync(join(outDir, 'components/card/_partial.twig'))).toBe(
      false,
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
      false,
    );
    expect(existsSync(join(outDir, 'components/card/card.component.yml'))).toBe(
      true,
    );
    expect(existsSync(join(outDir, 'components/card/image.png'))).toBe(true);
    expect(existsSync(join(outDir, 'foundation/icons/icon.svg'))).toBe(true);
    expect(existsSync(join(outDir, 'foundation/icons/_partial.twig'))).toBe(
      false,
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

    it('leaves partials and compiled entries out of the watch set', () => {
      // Partials are not copied, and Rollup already watches the SCSS it compiles.
      // Registering either here would buy a rebuild that copies nothing.
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

      expect(watched.some((path) => path.endsWith('_partial.twig'))).toBe(
        false,
      );
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
        false,
      );
    });
  });
});
