/**
 * @file Twig.js extension registration entry point.
 * @module extensions/twig/register
 */

import { getTwigFunctionMap } from './function-map.js';

/**
 * Twig instances that have already received the native function map.
 *
 * @type {WeakSet<Object>}
 */
const registeredTwigInstances = new WeakSet();

/**
 * Register native Emulsify Twig functions with a Twig.js instance.
 *
 * @param {Object} Twig - Twig.js module or compatible extension target.
 * @returns {Object} The same Twig instance after registration.
 * @throws {TypeError} When the provided value cannot register Twig functions.
 */
export function registerTwigExtensions(Twig) {
  if (!Twig || typeof Twig.extendFunction !== 'function') {
    throw new TypeError(
      'A Twig.js instance with extendFunction() is required.',
    );
  }

  if (registeredTwigInstances.has(Twig)) {
    return Twig;
  }

  // Register once so repeated Storybook/Vite setup calls stay idempotent.
  for (const [name, definition] of Object.entries(getTwigFunctionMap())) {
    Twig.extendFunction(name, definition);
  }

  registeredTwigInstances.add(Twig);
  return Twig;
}
