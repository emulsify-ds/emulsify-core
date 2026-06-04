/**
 * @file Tests for Storybook Twig runtime setup.
 */

import { setupTwig } from './setup.js';

describe('Storybook Twig setup', () => {
  it('registers Emulsify Twig helpers, include(), source(), and optional platform extensions', () => {
    const functionNames = [];
    const tagTypes = [];
    const platformExtension = jest.fn();
    const Twig = {
      cache: jest.fn(),
      extend: jest.fn((callback) => callback({})),
      extendFunction: jest.fn((name) => {
        functionNames.push(name);
      }),
      extendTag: jest.fn((definition) => {
        tagTypes.push(definition.type);
      }),
    };

    expect(setupTwig(Twig, { extensions: [platformExtension] })).toBe(Twig);

    expect(Twig.cache).toHaveBeenCalledTimes(1);
    expect(functionNames).toEqual(
      expect.arrayContaining(['add_attributes', 'bem', 'include', 'source']),
    );
    expect(tagTypes).toEqual(
      expect.arrayContaining([
        'emulsify_switch',
        'emulsify_case',
        'emulsify_default',
        'emulsify_endswitch',
      ]),
    );
    expect(platformExtension).toHaveBeenCalledWith(Twig);
  });
});
