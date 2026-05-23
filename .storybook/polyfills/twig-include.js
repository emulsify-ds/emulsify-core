
import resolveTemplate from './twig-resolver.js';

/**
 * Twig `include()` polyfill.
 * Provides Storybook compatibility for Drupal-style include() calls while the
 * underlying Twig renderer remains platform-agnostic.
 * @param {string} templateName
 * @param {Object} [variables]
 * @param {boolean} [withContext=false]
 * @return {string}
 */
function twigInclude(Twig) {
  Twig.extendFunction('include', (...args) => {
    let [templateName, variables = {}, withContext = false] = args;
    if (typeof withContext !== 'boolean' && variables && typeof variables.with_context !== 'undefined') {
      withContext = variables.with_context;
      delete variables.with_context;
    }

    try {
      const templateFn = resolveTemplate(templateName);
      if (!templateFn) return '';

      const finalContext = withContext && typeof this === 'object'
        ? { ...(this.context || {}), ...variables }
        : variables;

      return templateFn(finalContext);
    } catch (err) {
      console.error(`Twig include() failed for: ${templateName}`, err);
      return '';
    }
  });
};

export default twigInclude;
