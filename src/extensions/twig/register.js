import { getTwigFunctionMap } from './function-map.js';

const registeredTwigInstances = new WeakSet();

export function registerTwigExtensions(Twig) {
  if (!Twig || typeof Twig.extendFunction !== 'function') {
    throw new TypeError(
      'A Twig.js instance with extendFunction() is required.',
    );
  }

  if (registeredTwigInstances.has(Twig)) {
    return Twig;
  }

  for (const [name, definition] of Object.entries(getTwigFunctionMap())) {
    Twig.extendFunction(name, definition);
  }

  registeredTwigInstances.add(Twig);
  return Twig;
}
