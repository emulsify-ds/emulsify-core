// Simple Drupal.behaviors usage for Storybook

/**
 * Global Drupal namespace stub for Storybook environment.
 * @namespace Drupal
 */
window.Drupal = { behaviors: {} };

/**
 * Immediately-Invoked Function Expression to scope Drupal behavior attachment logic.
 * @param {Object} Drupal - The Drupal global namespace object.
 * @param {Object} drupalSettings - Global Drupal settings object stub.
 */
(function (Drupal, drupalSettings) {
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

    // Iterate through each behavior and invoke its attach method if defined.
    Object.keys(behaviors).forEach(function (i) {
      if (typeof behaviors[i].attach === 'function') {
        try {
          behaviors[i].attach(context, settings);
        } catch (e) {
          Drupal.throwError(e);
        }
      }
    });
  };
})(Drupal, window.drupalSettings);
