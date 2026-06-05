/**
 * @file Tests for native Twig extension registration.
 */

import TwigJs from 'twig';

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

  it('adds a boolval fallback when Twig.js internals are missing it', () => {
    const InternalTwig = {};
    const Twig = {
      extend: jest.fn((callback) => callback(InternalTwig)),
      extendFunction: jest.fn(),
      extendTag: jest.fn(),
    };

    registerTwigExtensions(Twig);

    expect(typeof InternalTwig.lib.boolval).toBe('function');
    expect(InternalTwig.lib.boolval(false)).toBe(false);
    expect(InternalTwig.lib.boolval(0)).toBe(false);
    expect(InternalTwig.lib.boolval('')).toBe(false);
    expect(InternalTwig.lib.boolval('0')).toBe(false);
    expect(InternalTwig.lib.boolval([])).toBe(false);
    expect(InternalTwig.lib.boolval(null)).toBe(false);
    expect(InternalTwig.lib.boolval(undefined)).toBe(false);
    expect(InternalTwig.lib.boolval(true)).toBe(true);
    expect(InternalTwig.lib.boolval(1)).toBe(true);
    expect(InternalTwig.lib.boolval('false')).toBe(true);
    expect(InternalTwig.lib.boolval([0])).toBe(true);
  });

  it('preserves Twig.js own boolval helper when present', () => {
    const boolval = jest.fn(() => true);
    const InternalTwig = {
      lib: { boolval },
    };
    const Twig = {
      extend: jest.fn((callback) => callback(InternalTwig)),
      extendFunction: jest.fn(),
      extendTag: jest.fn(),
    };

    registerTwigExtensions(Twig);

    expect(InternalTwig.lib.boolval).toBe(boolval);
  });

  it('repairs a registered Twig.js instance before conditionals render', () => {
    const twig = TwigJs.factory();

    registerTwigExtensions(twig);
    twig.extend((InternalTwig) => {
      InternalTwig.lib.boolval = undefined;
    });
    registerTwigExtensions(twig);

    const template = twig.twig({
      data: '{% if value %}yes{% else %}no{% endif %}',
    });

    expect(template.render({ value: '0' })).toBe('no');
    expect(template.render({ value: 'ready' })).toBe('yes');
  });
});
