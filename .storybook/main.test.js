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

  it('serves compiled dist assets without mounting all dist files at the output root', () => {
    const script = `
      const { mkdirSync, mkdtempSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const path = await import('node:path');
      const { pathToFileURL } = await import('node:url');

      const repoRoot = process.cwd();
      const projectRoot = mkdtempSync(path.join(tmpdir(), 'emulsify-storybook-'));
      mkdirSync(path.join(projectRoot, 'assets'), { recursive: true });
      mkdirSync(path.join(projectRoot, 'dist/assets'), { recursive: true });
      mkdirSync(path.join(projectRoot, 'dist/storybook'), { recursive: true });
      process.chdir(projectRoot);

      const { default: config } = await import(
        pathToFileURL(path.join(repoRoot, '.storybook/main.js')).href
      );

      console.log(JSON.stringify({
        staticDirs: config.staticDirs,
        projectRoot: process.cwd(),
      }));
    `;
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      script,
    ]);
    const { staticDirs, projectRoot } = JSON.parse(output.toString());

    expect(staticDirs).toEqual([
      {
        from: `${projectRoot}/assets`,
        to: '/assets',
      },
      {
        from: `${projectRoot}/dist/assets`,
        to: '/assets',
      },
      {
        from: `${projectRoot}/dist`,
        to: '/dist',
      },
    ]);
  });

  it('keeps Storybook preview build assets separate from static /assets', async () => {
    const script = `
      const { default: config } = await import('./.storybook/main.js');
      const finalConfig = await config.viteFinal({
        mode: 'production',
        build: {
          outDir: '.out',
          assetsDir: 'assets',
          emptyOutDir: false,
        },
        server: {
          fs: {
            allow: [],
          },
        },
        optimizeDeps: {},
      });
      console.log(JSON.stringify(finalConfig.build));
    `;
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      script,
    ]);
    const build = JSON.parse(output.toString());

    expect(build.outDir).toBe('.out');
    expect(build.assetsDir).toBe('storybook-assets');
    expect(build.emptyOutDir).toBe(false);
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
      'virtual:emulsify-twig-extension-installers',
      '@emulsify/core/storybook/twig/source-function',
      '@emulsify/core/storybook/twig/source',
      '@emulsify/core/storybook/twig/resolver',
    ]);
    expect(finalConfig.esbuildPluginNames).toContain(
      'emulsify-twig-virtual-modules',
    );
  });
});
