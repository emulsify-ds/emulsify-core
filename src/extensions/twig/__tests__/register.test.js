/**
 * @file Tests for native Twig extension registration.
 */

import { getTwigFunctionMap } from '../function-map.js';
import { registerTwigExtensions } from '../register.js';

describe('registerTwigExtensions', () => {
  it('registers all native Twig functions once per Twig instance', () => {
    const Twig = {
      extendFunction: jest.fn(),
    };

    registerTwigExtensions(Twig);
    registerTwigExtensions(Twig);

    const functionNames = Object.keys(getTwigFunctionMap());
    expect(Twig.extendFunction).toHaveBeenCalledTimes(functionNames.length);

    for (const name of functionNames) {
      expect(Twig.extendFunction).toHaveBeenCalledWith(
        name,
        expect.any(Function),
      );
    }
  });

  it('requires a Twig.js-compatible instance', () => {
    expect(() => registerTwigExtensions({})).toThrow(
      'A Twig.js instance with extendFunction() is required.',
    );
  });
});
