/**
 * @file Tests for guarded Vituum Twig plugin patching.
 */

import { makeTwigPlugins } from '../vituum-patch.js';

let mockTwigPluginResult;

jest.mock('@vituum/vite-plugin-twig', () => ({
  __esModule: true,
  default: jest.fn(() => mockTwigPluginResult),
}));

const twigPlugin = (overrides = {}) => ({
  name: '@vituum/vite-plugin-twig',
  buildStart: jest.fn(),
  buildEnd: jest.fn(),
  ...overrides,
});

const bundlePlugin = (overrides = {}) => ({
  name: '@vituum/vite-plugin-core:bundle',
  ...overrides,
});

const makePatchedPlugins = () => makeTwigPlugins({}, {});

describe('makeTwigPlugins', () => {
  beforeEach(() => {
    mockTwigPluginResult = [twigPlugin(), bundlePlugin()];
  });

  it('removes Vituum bundle plugin and strips incompatible Twig build hooks', () => {
    const plugins = makePatchedPlugins();
    const names = plugins.map((pluginOption) => pluginOption?.name);
    const patchedTwigPlugin = plugins.find(
      (pluginOption) => pluginOption?.name === '@vituum/vite-plugin-twig',
    );

    expect(names).toContain('@vituum/vite-plugin-twig');
    expect(names).not.toContain('@vituum/vite-plugin-core:bundle');
    expect(patchedTwigPlugin).not.toHaveProperty('buildStart');
    expect(patchedTwigPlugin).not.toHaveProperty('buildEnd');
  });

  it('throws when the expected Vituum Twig plugin is missing', () => {
    mockTwigPluginResult = [
      bundlePlugin(),
      { name: '@vituum/vite-plugin-other' },
    ];

    expect(() => makePatchedPlugins()).toThrow(
      /expected '@vituum\/vite-plugin-twig' not found/,
    );
  });

  it('throws when the Vituum Twig plugin has none of the targeted hooks', () => {
    mockTwigPluginResult = [
      {
        name: '@vituum/vite-plugin-twig',
        transform: jest.fn(),
      },
      bundlePlugin(),
    ];

    expect(() => makePatchedPlugins()).toThrow(
      /did not expose any targeted hooks to strip/,
    );
  });

  it('preserves extra hooks on the Vituum Twig plugin', () => {
    const transform = jest.fn();
    mockTwigPluginResult = [twigPlugin({ transform }), bundlePlugin()];

    const plugins = makePatchedPlugins();
    const patchedTwigPlugin = plugins.find(
      (pluginOption) => pluginOption?.name === '@vituum/vite-plugin-twig',
    );

    expect(patchedTwigPlugin).toHaveProperty('transform', transform);
    expect(patchedTwigPlugin).not.toHaveProperty('buildStart');
    expect(patchedTwigPlugin).not.toHaveProperty('buildEnd');
  });
});
