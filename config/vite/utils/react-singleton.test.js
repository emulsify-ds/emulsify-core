/**
 * @file Tests for React singleton Vite utilities.
 */

import {
  mergeReactSingletonOptimizeDeps,
  mergeReactSingletonResolve,
  reactSingletonModules,
} from './react-singleton.js';

describe('React singleton Vite utilities', () => {
  it('adds React runtime modules to resolve.dedupe without dropping existing entries', () => {
    expect(
      mergeReactSingletonResolve(
        {
          resolve: {
            alias: { '@core': '/core' },
            dedupe: ['twig', 'react'],
          },
        },
        {
          resolve: {
            alias: { '@project': '/project' },
            dedupe: ['storybook'],
          },
        },
      ),
    ).toEqual({
      alias: { '@core': '/core', '@project': '/project' },
      dedupe: ['twig', 'react', 'storybook', ...reactSingletonModules.slice(1)],
    });
  });

  it('adds React runtime modules to optimizeDeps include without duplicates', () => {
    expect(
      mergeReactSingletonOptimizeDeps(
        ['twig', 'react'],
        ['@emulsify/core/extensions/twig', 'react-dom'],
      ),
    ).toEqual([
      'twig',
      'react',
      '@emulsify/core/extensions/twig',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
    ]);
  });
});
