/**
 * @file Tests for the shared Storybook main config.
 */

import { execFileSync } from 'node:child_process';

describe('Storybook main config', () => {
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
  });
});
