/**
 * @file Tests for shared Storybook runtime helpers.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

async function loadUtils(env) {
  jest.resetModules();
  if (env) {
    globalThis.__EMULSIFY_ENV__ = env;
  } else {
    delete globalThis.__EMULSIFY_ENV__;
  }

  return import('./utils.js');
}

describe('Storybook utility helpers', () => {
  let importMetaGlob;

  beforeEach(() => {
    importMetaGlob = jest.fn(() => ({}));
    globalThis.__viteImportMetaGlob = importMetaGlob;
  });

  afterEach(() => {
    delete globalThis.__EMULSIFY_ENV__;
    delete globalThis.__viteImportMetaGlob;
  });

  it('loads dist CSS through the virtual stylesheet loader for the none adapter', async () => {
    const { fetchCSSFiles } = await loadUtils();

    await fetchCSSFiles();

    expect(importMetaGlob).not.toHaveBeenCalled();
  });

  it('loads mirrored component CSS and shared dist CSS when the adapter enables it', async () => {
    const { fetchCSSFiles } = await loadUtils({
      platformAdapter: {
        storybook: {
          loadMirroredComponentCss: true,
        },
      },
    });

    await fetchCSSFiles();

    expect(importMetaGlob).toHaveBeenCalledTimes(1);
    expect(importMetaGlob).toHaveBeenCalledWith(
      '../../../../components/**/*.css',
      { eager: true },
    );
  });

  it('skips eager CSS loading when parameters disable it', async () => {
    const { fetchCSSFiles, getLoadAllCSS } = await loadUtils();

    expect(getLoadAllCSS()).toBe(true);
    expect(getLoadAllCSS({ emulsify: { loadAllCSS: false } })).toBe(false);
    await fetchCSSFiles({ emulsify: { loadAllCSS: false } });

    expect(importMetaGlob).not.toHaveBeenCalled();
  });

  it('keeps eager CSS globs out of the branching utility module', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./utils.js', import.meta.url)),
      'utf8',
    );

    expect(source).not.toContain('import.meta.glob(');
  });
});
