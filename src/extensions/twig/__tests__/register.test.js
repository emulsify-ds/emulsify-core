/**
 * @file Tests for native Twig extension registration.
 */

import { getTwigFunctionMap } from '../function-map.js';
import { getTwigTagDefinitions } from '../tag-map.js';
import { registerTwigExtensions } from '../register.js';

describe('registerTwigExtensions', () => {
  it('registers all native Twig extensions once per Twig instance', () => {
    const InternalTwig = {};
    const Twig = {
      extend: jest.fn((callback) => callback(InternalTwig)),
      extendFunction: jest.fn(),
      extendTag: jest.fn(),
    };

    // Calling twice should not duplicate Twig.js extension registration.
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

    const tagDefinitions = getTwigTagDefinitions(InternalTwig);
    expect(Twig.extendTag).toHaveBeenCalledTimes(tagDefinitions.length);

    for (const definition of tagDefinitions) {
      expect(Twig.extendTag).toHaveBeenCalledWith(
        expect.objectContaining({
          type: definition.type,
          regex: definition.regex,
        }),
      );
    }
  });

  it('requires a Twig.js-compatible instance', () => {
    expect(() => registerTwigExtensions({})).toThrow(
      'A Twig.js instance with extendFunction(), extendTag(), and extend() is required.',
    );
  });
});
