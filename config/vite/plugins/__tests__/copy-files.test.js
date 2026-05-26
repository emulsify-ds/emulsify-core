/**
 * @file Tests for source Twig, metadata, and static asset copy plugins.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { resolveProjectConfig } from '../../project-config.js';
import { resolveProjectStructure } from '../../project-structure.js';
import { copyAllSrcAssetsPlugin } from '../copy-src-assets.js';
import { copyTwigFilesPlugin } from '../copy-twig-files.js';
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
    copyTwigPlugin.closeBundle();
    copyAssetsPlugin.closeBundle();
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
    writeFileSync(join(componentDir, 'card.js'), 'console.log("skip");');
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
    expect(existsSync(join(outDir, 'components/card/card.js'))).toBe(false);
    expect(existsSync(join(outDir, 'components/card/card.scss'))).toBe(false);
  });

  it('copies assets from named structure roots to matching dist folders', () => {
    projectDir = makeTempProject();
    const outDir = join(projectDir, 'dist');
    writeProjectConfig(projectDir, {
      project: {
        platform: 'generic',
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
});
