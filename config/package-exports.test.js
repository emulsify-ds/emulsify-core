/**
 * @file Smoke tests for the package public exports map.
 */

import { execFileSync } from 'node:child_process';

describe('@emulsify/core package exports', () => {
  it('imports each public export with native Node ESM resolution', () => {
    const checks = [
      ['@emulsify/core', ['react', 'twig']],
      ['@emulsify/core/extensions', ['react', 'twig']],
      [
        '@emulsify/core/extensions/twig',
        ['getTwigFunctionMap', 'registerTwigExtensions'],
      ],
      [
        '@emulsify/core/extensions/react',
        ['createReactExtensionRegistry', 'defineReactExtension'],
      ],
      ['@emulsify/core/storybook', ['renderTwig', 'TwigStory']],
      ['@emulsify/core/vite', ['default']],
      [
        '@emulsify/core/vite/plugins',
        ['makePlugins', 'makeTwigNamespaces', 'makeTwigPluginOptions'],
      ],
    ];
    const script = `
      const checks = ${JSON.stringify(checks)};
      for (const [specifier, expectedExports] of checks) {
        const module = await import(specifier);
        for (const exportName of expectedExports) {
          if (module[exportName] === undefined) {
            throw new Error(\`Missing \${exportName} from \${specifier}\`);
          }
        }
      }
      const { renderTwig } = await import('@emulsify/core/storybook');
      if (typeof renderTwig !== 'function') {
        throw new Error('renderTwig is not a function');
      }
      try {
        await import('@emulsify/core/config/vite/project-config.js');
        throw new Error('Internal project-config import unexpectedly succeeded');
      } catch (error) {
        if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
          throw error;
        }
      }
    `;

    expect(() => {
      execFileSync(process.execPath, ['--input-type=module', '--eval', script]);
    }).not.toThrow();
  });

  it('exposes renderTwig from the Storybook public entry', async () => {
    const { renderTwig } = await import('@emulsify/core/storybook');

    expect(typeof renderTwig).toBe('function');
  });

  it('does not expose internal implementation subpaths to Jest resolution', async () => {
    await expect(
      import('@emulsify/core/config/vite/project-config.js'),
    ).rejects.toThrow();
  });
});
