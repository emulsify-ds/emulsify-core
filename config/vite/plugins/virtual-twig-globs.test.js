/**
 * @file Tests for the Twig glob virtual module plugin.
 */

import {
  generateVirtualTwigGlobsModule,
  twigGlobPatterns,
  VIRTUAL_TWIG_GLOBS_ID,
  virtualTwigGlobsPlugin,
} from './virtual-twig-globs.js';
import { toRootRelativePath as toTemplateRootRelativePath } from '../../../src/storybook/twig/reference-paths.js';

const env = {
  projectDir: '/project',
  projectStructure: {
    twigRoots: ['/project/src/components', '/project/src/layout'],
  },
};

describe('virtual Twig glob module plugin', () => {
  it('resolves and loads the virtual module', () => {
    const plugin = virtualTwigGlobsPlugin(env);
    const resolvedId = plugin.resolveId(VIRTUAL_TWIG_GLOBS_ID);

    expect(resolvedId).toBe('\0virtual:emulsify-twig-globs');
    expect(plugin.resolveId('/real/module.js')).toBeNull();
    expect(plugin.load(resolvedId)).toContain(
      'export const modules = globMaps.modules;',
    );
    expect(plugin.load('/real/module.js')).toBeNull();
  });

  it('generates named exports from resolved Twig roots', () => {
    const source = generateVirtualTwigGlobsModule(env);

    expect(source).toContain('const globMaps = mergeGlobMaps([');
    expect(source.match(/mergeGlobMaps\(\[/g)).toHaveLength(1);
    expect(source).toContain(
      'modules: import.meta.glob("/src/components/**/*.twig", { eager: true })',
    );
    expect(source).toContain(
      'modules: import.meta.glob("/src/layout/**/*.twig", { eager: true })',
    );
    expect(source).toContain(
      'Raw source\n * entries stay lazy and load only when Twig source() requests a template.',
    );
    expect(source).toMatch(
      /sources: import\.meta\.glob\("\/src\/components\/\*\*\/\*\.twig", \{ query: '\?raw', import: 'default' \}\)/,
    );
    expect(source).toMatch(
      /sources: import\.meta\.glob\("\/src\/layout\/\*\*\/\*\.twig", \{ query: '\?raw', import: 'default' \}\)/,
    );
    expect(source).not.toContain(
      'sources: import.meta.glob("/src/components/**/*.twig", { eager: true, query: \'?raw\'',
    );
    expect(source).toContain('export const modules = globMaps.modules;');
    expect(source).toContain('export const sources = globMaps.sources;');
  });

  it.each([
    {
      label: 'trailing project slash',
      projectDir: '/project/',
      absolutePath: '/project/src/components',
      expectedRoot: '/src/components',
    },
    {
      label: 'double slashes',
      projectDir: '/project//',
      absolutePath: '/project//src//components//',
      expectedRoot: '/src/components',
    },
    {
      label: 'Windows backslashes',
      projectDir: 'C:\\project\\theme',
      absolutePath: 'C:\\project\\theme\\src\\components',
      expectedRoot: '/src/components',
    },
    {
      label: 'project root',
      projectDir: '/project',
      absolutePath: '/project',
      expectedRoot: '/',
    },
    {
      label: 'outside project root',
      projectDir: '/project',
      absolutePath: '/other/src/components',
      expectedRoot: '/other/src/components',
    },
  ])(
    'uses one key algorithm for template IDs and glob keys: $label',
    ({ projectDir, absolutePath, expectedRoot }) => {
      const edgeEnv = {
        projectDir,
        projectStructure: {
          twigRoots: [absolutePath],
        },
      };
      const [globPattern] = twigGlobPatterns(edgeEnv);
      const globRoot =
        globPattern === '/**/*.twig'
          ? '/'
          : globPattern.replace(/\/\*\*\/\*\.twig$/, '');

      expect(toTemplateRootRelativePath(absolutePath, edgeEnv)).toBe(
        expectedRoot,
      );
      expect(globRoot).toBe(expectedRoot);
    },
  );
});
