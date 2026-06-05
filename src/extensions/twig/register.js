/**
 * @file Twig.js extension registration entry point.
 * @module extensions/twig/register
 */

import { getTwigFunctionMap } from './function-map.js';
import { getTwigTagDefinitions } from './tag-map.js';

/**
 * Twig instances that have already received native Emulsify extensions.
 *
 * @type {WeakSet<Object>}
 */
const registeredTwigInstances = new WeakSet();

/**
 * PHP-style boolean conversion used by Twig.js truthiness checks.
 *
 * Twig.js normally provides this through `Twig.lib.boolval`, but dependency
 * optimizer interop can drop the helper while leaving the rest of Twig usable.
 *
 * @param {*} value - Value to coerce using PHP/Twig truthiness rules.
 * @returns {boolean} TRUE when the value should be truthy in Twig.
 */
function phpBoolval(value) {
  return (
    value !== false &&
    value !== 0 &&
    value !== '' &&
    value !== '0' &&
    !(Array.isArray(value) && value.length === 0) &&
    value !== null &&
    typeof value !== 'undefined'
  );
}

/**
 * Ensure Twig.js has the internal boolean helper required by conditionals.
 *
 * @param {Object} Twig - Twig.js module or compatible extension target.
 * @returns {Object} The same Twig instance after compatibility patching.
 */
function ensureTwigBoolval(Twig) {
  Twig.extend((InternalTwig) => {
    if (!InternalTwig.lib) {
      InternalTwig.lib = {};
    }

    if (typeof InternalTwig.lib.boolval !== 'function') {
      InternalTwig.lib.boolval = phpBoolval;
    }
  });

  return Twig;
}

/**
 * Register native Emulsify Twig functions and logic tags with Twig.js.
 *
 * @param {Object} Twig - Twig.js module or compatible extension target.
 * @returns {Object} The same Twig instance after registration.
 * @throws {TypeError} When the provided value cannot register Twig extensions.
 */
export function registerTwigExtensions(Twig) {
  if (
    !Twig ||
    typeof Twig.extendFunction !== 'function' ||
    typeof Twig.extendTag !== 'function' ||
    typeof Twig.extend !== 'function'
  ) {
    throw new TypeError(
      'A Twig.js instance with extendFunction(), extendTag(), and extend() is required.',
    );
  }

  ensureTwigBoolval(Twig);

  if (registeredTwigInstances.has(Twig)) {
    return Twig;
  }

  // Register once so repeated Storybook/Vite setup calls stay idempotent.
  for (const [name, definition] of Object.entries(getTwigFunctionMap())) {
    Twig.extendFunction(name, definition);
  }

  Twig.extend((InternalTwig) => {
    for (const definition of getTwigTagDefinitions(InternalTwig)) {
      Twig.extendTag(definition);
    }
  });

  registeredTwigInstances.add(Twig);
  return Twig;
}
