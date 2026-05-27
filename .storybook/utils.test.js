/**
 * @file Tests for shared Storybook runtime helpers.
 */

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

  it('loads dist CSS only for the generic adapter', async () => {
    const { fetchCSSFiles } = await loadUtils();

    fetchCSSFiles();

    expect(importMetaGlob).toHaveBeenCalledTimes(1);
    expect(importMetaGlob).toHaveBeenCalledWith('../../../../dist/**/*.css', {
      eager: true,
    });
  });

  it('loads mirrored component CSS only when the adapter enables it', async () => {
    const { fetchCSSFiles } = await loadUtils({
      platformAdapter: {
        storybook: {
          loadMirroredComponentCss: true,
        },
      },
    });

    fetchCSSFiles();

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
    fetchCSSFiles({ emulsify: { loadAllCSS: false } });

    expect(importMetaGlob).not.toHaveBeenCalled();
  });
});
