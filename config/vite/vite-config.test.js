/**
 * @file Integration tests for the shipped Vite configuration.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

describe('Vite build policy', () => {
  let projectDir;

  afterEach(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  it('keeps watch output readable and development-only source maps enabled', () => {
    const configUrl = pathToFileURL(
      join(process.cwd(), 'config/vite/vite.config.js'),
    ).href;
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          const { default: viteConfig } = await import(${JSON.stringify(configUrl)});

          process.argv = ['node', 'vite', 'build', '--watch'];
          const watchConfig = await viteConfig({ command: 'build' });

          process.argv = ['node', 'vite', 'build'];
          const productionConfig = await viteConfig({ command: 'build' });

          console.log(JSON.stringify({
            watch: {
              sourcemap: watchConfig.build.sourcemap,
              minify: watchConfig.build.minify,
              cssMinify: watchConfig.build.cssMinify,
            },
            production: {
              sourcemap: productionConfig.build.sourcemap,
              minify: productionConfig.build.minify,
              cssMinify: productionConfig.build.cssMinify,
            },
          }));
        `,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout);
    }

    expect(JSON.parse(result.stdout)).toEqual({
      watch: {
        sourcemap: true,
        minify: false,
        cssMinify: false,
      },
      production: {
        sourcemap: false,
        minify: true,
        cssMinify: true,
      },
    });
  });

  it('applies development defaults when a project extension enables watch', () => {
    projectDir = mkdtempSync(join(tmpdir(), 'emulsify-watch-config-'));
    const extensionDir = join(projectDir, 'config/emulsify-core/vite');
    mkdirSync(extensionDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'project.emulsify.json'),
      '{"project":{"platform":"none"}}\n',
    );
    writeFileSync(
      join(extensionDir, 'plugins.mjs'),
      `export function extendConfig() {
        return { build: { watch: {} } };
      }
      `,
    );

    const configUrl = pathToFileURL(
      join(process.cwd(), 'config/vite/vite.config.js'),
    ).href;
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
          const { default: viteConfig } = await import(${JSON.stringify(configUrl)});
          process.argv = ['node', 'vite', 'build'];
          const config = await viteConfig({ command: 'build' });
          console.log(JSON.stringify({
            watch: config.build.watch,
            sourcemap: config.build.sourcemap,
            minify: config.build.minify,
            cssMinify: config.build.cssMinify,
          }));
        `,
      ],
      { cwd: projectDir, encoding: 'utf8' },
    );

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout);
    }

    expect(JSON.parse(result.stdout)).toEqual({
      watch: {},
      sourcemap: true,
      minify: false,
      cssMinify: false,
    });
  });
});
