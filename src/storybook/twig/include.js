/**
 * @file Twig include() runtime helper for Storybook-rendered templates.
 */

import resolveTemplate from './resolver.js';

/**
 * Normalize optional include arguments into one options object.
 *
 * @param {Object} variables - Explicit include variables.
 * @param {boolean|Object} withContext - Twig with-context flag or options.
 * @param {boolean} ignoreMissing - Twig ignore-missing flag.
 * @returns {{variables: Object, withContext: boolean, ignoreMissing: boolean}}
 *   Normalized include arguments.
 */
function normalizeIncludeOptions(
  variables = {},
  withContext = false,
  ignoreMissing = false,
) {
  const normalizedVariables =
    variables && typeof variables === 'object' && !Array.isArray(variables)
      ? { ...variables }
      : {};

  if (typeof normalizedVariables.with_context !== 'undefined') {
    withContext = normalizedVariables.with_context;
    delete normalizedVariables.with_context;
  }

  if (typeof normalizedVariables.ignore_missing !== 'undefined') {
    ignoreMissing = normalizedVariables.ignore_missing;
    delete normalizedVariables.ignore_missing;
  }

  if (withContext && typeof withContext === 'object') {
    const optionsObject = withContext;

    if (typeof optionsObject.with_context !== 'undefined') {
      withContext = optionsObject.with_context;
    }
    if (typeof optionsObject.ignore_missing !== 'undefined') {
      ignoreMissing = optionsObject.ignore_missing;
    }
  }

  return {
    variables: normalizedVariables,
    withContext: Boolean(withContext),
    ignoreMissing: Boolean(ignoreMissing),
  };
}

/**
 * Find the first resolvable include target.
 *
 * @param {string|string[]} templateName - Template name or ordered candidates.
 * @param {Function} resolver - Template resolver.
 * @returns {Function|undefined} Resolved template render function.
 */
function resolveIncludeTarget(templateName, resolver) {
  const names = Array.isArray(templateName) ? templateName : [templateName];

  for (const name of names) {
    const template = resolver(name);
    if (template) {
      return template;
    }
  }

  return undefined;
}

/**
 * Create a Twig.js `include()` function for Storybook rendering.
 *
 * @param {Function} resolver - Template resolver.
 * @returns {Function} Twig.js function implementation.
 */
export function createTwigIncludeFunction(resolver = resolveTemplate) {
  return function include(templateName, variables, withContext, ignoreMissing) {
    const options = normalizeIncludeOptions(
      variables,
      withContext,
      ignoreMissing,
    );

    try {
      const templateFn = resolveIncludeTarget(templateName, resolver);
      if (!templateFn) {
        if (!options.ignoreMissing) {
          console.error(`Twig include() could not resolve: ${templateName}`);
        }
        return '';
      }

      const finalContext = options.withContext
        ? { ...(this?.context || {}), ...options.variables }
        : options.variables;

      return templateFn(finalContext);
    } catch (error) {
      if (!options.ignoreMissing) {
        console.error(`Twig include() failed for: ${templateName}`, error);
      }
      return '';
    }
  };
}

/**
 * Twig `include()` runtime helper.
 *
 * @param {Object} Twig - Twig.js module.
 * @returns {undefined}
 */
function twigInclude(Twig) {
  Twig.extendFunction('include', createTwigIncludeFunction());
}

export default twigInclude;
