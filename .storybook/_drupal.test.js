/**
 * @file Tests for the Storybook Drupal behavior shim.
 */

describe('Storybook Drupal behavior shim', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    delete window.Drupal;
    delete window.drupalSettings;
    delete globalThis.__EMULSIFY_ENV__;
  });

  it('initializes Drupal globals, settings, and behavior callbacks', async () => {
    await import('./_drupal.js');

    const context = document.createElement('section');
    const attach = jest.fn();
    window.Drupal.behaviors.example = { attach };

    window.Drupal.attachBehaviors(context);

    expect(window.drupalSettings).toMatchObject({
      path: {
        baseUrl: '/',
        currentLanguage: 'en',
        isFront: false,
        langcode: 'en',
        pathPrefix: '',
        currentPath: '/',
        currentPathIsAdmin: false,
      },
      user: {
        uid: 0,
        permissionsHash: '',
      },
      ajaxPageState: {
        theme: '',
        theme_token: '',
      },
      ajaxTrustedUrl: {},
      pluralDelimiter: '\u0003',
    });
    expect(window.Drupal.t('Hello @name', { '@name': 'World' })).toBe(
      'Hello World',
    );
    expect(attach).toHaveBeenCalledWith(context, window.drupalSettings);
  });

  it('preserves project-provided Drupal settings while adding defaults', async () => {
    window.drupalSettings = {
      path: {
        currentLanguage: 'es',
      },
      ajaxPageState: {
        theme: 'custom_theme',
      },
      projectModule: {
        enabled: true,
      },
    };

    await import('./_drupal.js');

    expect(window.drupalSettings.path).toEqual({
      baseUrl: '/',
      currentLanguage: 'es',
      isFront: false,
      langcode: 'en',
      pathPrefix: '',
      currentPath: '/',
      currentPathIsAdmin: false,
    });
    expect(window.drupalSettings.ajaxPageState).toEqual({
      theme: 'custom_theme',
      theme_token: '',
    });
    expect(window.drupalSettings.projectModule).toEqual({
      enabled: true,
    });
  });

  it('uses the project machine name as the default Drupal theme setting', async () => {
    globalThis.__EMULSIFY_ENV__ = {
      machineName: 'example_theme',
    };

    await import('./_drupal.js');

    expect(window.drupalSettings.ajaxPageState.theme).toBe('example_theme');
  });

  it('preserves an existing Drupal.t implementation', async () => {
    const translate = jest.fn(() => 'translated');
    window.Drupal = {
      t: translate,
    };

    await import('./_drupal.js');

    expect(window.Drupal.t('Source')).toBe('translated');
    expect(translate).toHaveBeenCalledWith('Source');
  });
});
