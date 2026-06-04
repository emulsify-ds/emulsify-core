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
