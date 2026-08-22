/**
 * @file Integration tests for the shipped Vite configuration.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

describe('Vite build policy', () => {
  it('emits JavaScript source maps only for watch builds', () => {
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
            watch: watchConfig.build.sourcemap,
            production: productionConfig.build.sourcemap,
          }));
        `,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout);
    }

    expect(JSON.parse(result.stdout)).toEqual({
      watch: true,
      production: false,
    });
  });
});
