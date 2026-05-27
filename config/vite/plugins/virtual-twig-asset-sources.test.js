/**
 * @file Tests for the Twig text asset source virtual module plugin.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  assetSourceGlobPatterns,
  generateVirtualTwigAssetSourcesModule,
  VIRTUAL_TWIG_ASSET_SOURCES_ID,
  virtualTwigAssetSourcesPlugin,
} from './virtual-twig-asset-sources.js';

const makeTempProject = () =>
  mkdtempSync(join(tmpdir(), 'emulsify-asset-sources-'));

describe('virtual Twig asset source module plugin', () => {
  let projectDir;

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('resolves and loads the virtual module', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'assets'), { recursive: true });
    const env = { projectDir, projectStructure: {} };
    const plugin = virtualTwigAssetSourcesPlugin(env);
    const resolvedId = plugin.resolveId(VIRTUAL_TWIG_ASSET_SOURCES_ID);

    expect(resolvedId).toBe('\0virtual:emulsify-twig-asset-sources');
    expect(plugin.resolveId('/real/module.js')).toBeNull();
    expect(plugin.load(resolvedId)).toContain('export const assets =');
    expect(plugin.load('/real/module.js')).toBeNull();
  });

  it('generates lazy raw-source globs for default asset roots that exist', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'src/assets'), { recursive: true });
    mkdirSync(join(projectDir, 'assets'), { recursive: true });
    const env = { projectDir, projectStructure: {} };
    const source = generateVirtualTwigAssetSourcesModule(env);

    expect(assetSourceGlobPatterns(env)).toEqual([
      '/src/assets/**/*.{svg,html,twig,css,js,json,txt,md}',
      '/assets/**/*.{svg,html,twig,css,js,json,txt,md}',
    ]);
    expect(source).toContain(
      'Raw text assets stay lazy and load only when Twig source() requests them.',
    );
    expect(source).toMatch(
      /import\.meta\.glob\("\/src\/assets\/\*\*\/\*\.\{svg,html,twig,css,js,json,txt,md\}", \{ eager: false, query: '\?raw', import: 'default' \}\)/,
    );
    expect(source).toMatch(
      /import\.meta\.glob\("\/assets\/\*\*\/\*\.\{svg,html,twig,css,js,json,txt,md\}", \{ eager: false, query: '\?raw', import: 'default' \}\)/,
    );
    expect(source).not.toContain('{ eager: true');
    expect(source).toContain('export const assetRootPrefixes =');
    expect(source).toContain('export const getAssetText =');
  });

  it('uses configured asset roots when project structure provides them', () => {
    projectDir = makeTempProject();
    const assetRoot = join(projectDir, 'design/assets');
    mkdirSync(assetRoot, { recursive: true });
    const env = {
      projectDir,
      projectStructure: {
        assetRoots: [assetRoot],
      },
    };

    expect(assetSourceGlobPatterns(env)).toEqual([
      '/design/assets/**/*.{svg,html,twig,css,js,json,txt,md}',
    ]);
  });

  it('emits an empty asset map when no asset roots exist', () => {
    projectDir = makeTempProject();
    const source = generateVirtualTwigAssetSourcesModule({
      projectDir,
      projectStructure: {},
    });

    expect(source).toContain('export const assetRootPrefixes = [];');
    expect(source).toContain('export const assets = Object.assign({}, ...[');
    expect(source).not.toContain('import.meta.glob');
  });
});
