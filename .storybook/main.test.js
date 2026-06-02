/**
 * @file Tests for the shared Storybook main config.
 */

import { execFileSync } from 'node:child_process';
describe('Storybook main config', () => {
  it('serves project root assets at the /assets URL prefix', () => {
    const script = `
      const path = await import('node:path');
      const { default: config } = await import('./.storybook/main.js');
      console.log(JSON.stringify({
        staticDirs: config.staticDirs,
        expectedFrom: path.resolve(process.cwd(), 'assets'),
      }));
    `;
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      script,
    ]);
    const { staticDirs, expectedFrom } = JSON.parse(output.toString());

    expect(staticDirs).toContainEqual({
      from: expectedFrom,
      to: '/assets',
    });
  });

  it('dedupes React runtime modules in the final Vite config', async () => {
    const script = `
      const { default: config } = await import('./.storybook/main.js');
      const finalConfig = await config.viteFinal({
        mode: 'development',
        resolve: {
          dedupe: ['example', 'react'],
        },
        optimizeDeps: {
          include: ['example-dep', 'react'],
        },
        server: {
          fs: {
            allow: [],
          },
        },
      });
      console.log(JSON.stringify({
        dedupe: finalConfig.resolve.dedupe,
        include: finalConfig.optimizeDeps.include,
        exclude: finalConfig.optimizeDeps.exclude,
        esbuildPluginNames: finalConfig.optimizeDeps.esbuildOptions.plugins.map(
          (plugin) => plugin.name,
        ),
      }));
    `;
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      script,
    ]);
    const finalConfig = JSON.parse(output.toString());

    expect(finalConfig.dedupe).toEqual([
      'example',
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
    ]);
    expect(finalConfig.include).toEqual([
      'example-dep',
      'react',
      'twig',
      '@emulsify/core/extensions/twig',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
    ]);
    expect(finalConfig.exclude).toEqual([
      'virtual:emulsify-twig-globs',
      'virtual:emulsify-twig-asset-sources',
      '@emulsify/core/storybook/twig/source-function',
      '@emulsify/core/storybook/twig/source',
      '@emulsify/core/storybook/twig/resolver',
    ]);
    expect(finalConfig.esbuildPluginNames).toContain(
      'emulsify-twig-virtual-modules',
    );
  });
});
