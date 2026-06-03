/**
 * @file Drupal browser compatibility layer for Storybook.
 */

const emulsifyEnv =
  (typeof __EMULSIFY_ENV__ !== 'undefined' && __EMULSIFY_ENV__) || {};
const projectMachineName =
  typeof emulsifyEnv.machineName === 'string' ? emulsifyEnv.machineName : '';

/**
 * Storybook-safe defaults for the Drupal settings object.
 *
 * These values cover the common browser properties Drupal-authored JavaScript
 * reads while keeping project-specific module settings in project overrides.
 *
 * @type {object}
 */
const defaultDrupalSettings = {
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
    theme: projectMachineName,
    theme_token: '',
  },
  ajaxTrustedUrl: {},
  pluralDelimiter: '\u0003',
};

/**
 * Determine whether a value can be recursively merged as settings.
 *
 * @param {*} value - Candidate value.
 * @returns {boolean} TRUE when the value is a plain object.
 */
function isPlainObject(value) {
  return (
    Boolean(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

/**
 * Merge default settings with project-provided Drupal settings.
 *
 * Existing project settings win so projects can provide module-specific values
 * or override neutral defaults from `config/emulsify-core/storybook/preview.js`.
 *
 * @param {object} defaults - Default Drupal settings.
 * @param {object} overrides - Project-provided Drupal settings.
 * @returns {object} Merged settings object.
 */
function mergeDrupalSettings(defaults, overrides) {
  const merged = { ...defaults };

  for (const [key, value] of Object.entries(overrides || {})) {
    // Drupal settings keys are project/module-defined by design.
    // eslint-disable-next-line security/detect-object-injection
    const defaultValue = merged[key];
    const nextValue =
      isPlainObject(defaultValue) && isPlainObject(value)
        ? mergeDrupalSettings(defaultValue, value)
        : value;

    // Drupal settings keys are project/module-defined by design.
    // eslint-disable-next-line security/detect-object-injection
    merged[key] = nextValue;
  }

  return merged;
}

/**
 * Create the global Drupal namespace stub for the Storybook environment.
 *
 * @namespace Drupal
 */
window.Drupal = window.Drupal || {};
window.Drupal.behaviors = window.Drupal.behaviors || {};
window.drupalSettings = mergeDrupalSettings(
  defaultDrupalSettings,
  isPlainObject(window.drupalSettings) ? window.drupalSettings : {},
);

/**
 * Immediately-Invoked Function Expression to scope Drupal behavior attachment logic.
 * @param {Object} Drupal - The Drupal global namespace object.
 * @param {Object} drupalSettings - Global Drupal settings object stub.
 */
(function (Drupal, drupalSettings) {
  /**
   * Replaces Drupal-style string placeholders without translating the string.
   *
   * @param {string} str - String containing placeholders such as `@name`.
   * @param {Object.<string, string|number>} [args={}] - Placeholder values.
   * @returns {string} Formatted string.
   */
  Drupal.formatString =
    Drupal.formatString ||
    function (str, args = {}) {
      let formatted = String(str);

      for (const [placeholder, replacement] of Object.entries(args || {})) {
        formatted = formatted.split(placeholder).join(String(replacement));
      }

      return formatted;
    };

  /**
   * Minimal translation shim for Drupal-authored JavaScript in Storybook.
   *
   * @param {string} str - Source string.
   * @param {Object.<string, string|number>} [args={}] - Placeholder values.
   * @returns {string} Formatted source string.
   */
  Drupal.t =
    Drupal.t ||
    function (str, args = {}) {
      return Drupal.formatString(str, args);
    };

  /**
   * Throws an error asynchronously to avoid interrupting execution flow.
   * @param {Error} error - The error object to throw.
   * @returns {void}
   */
  Drupal.throwError = function (error) {
    setTimeout(function () {
      throw error;
    }, 0);
  };

  /**
   * Attaches all registered Drupal behaviors.
   * @param {HTMLElement|Document} [context=document] - DOM context to attach behaviors to.
   * @param {Object} [settings=drupalSettings] - Drupal settings to pass to behaviors.
   * @returns {void}
   */
  Drupal.attachBehaviors = function (context, settings) {
    context = context || document;
    settings = settings || drupalSettings;
    /** @type {Object.<string, {attach: Function}>} */
    const behaviors = Drupal.behaviors;

    // Attach each registered behavior while isolating individual failures.
    Object.keys(behaviors).forEach(function (behaviorName) {
      // Drupal behavior names are project/module-defined by design.
      // eslint-disable-next-line security/detect-object-injection
      const behavior = behaviors[behaviorName];
      if (typeof behavior.attach === 'function') {
        try {
          behavior.attach(context, settings);
        } catch (e) {
          Drupal.throwError(e);
        }
      }
    });
  };
})(window.Drupal, window.drupalSettings);
