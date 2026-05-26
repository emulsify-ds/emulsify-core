/**
 * @file Tests for reserved React extension helpers.
 */

import {
  createReactExtensionRegistry,
  defineReactExtension,
} from './register.js';

describe('React extension helpers', () => {
  it('returns the same React extension reference unchanged', () => {
    const extension = {
      name: 'project-react-components',
      components: {},
    };

    expect(defineReactExtension(extension)).toBe(extension);
  });

  it('filters falsy React extension registry values', () => {
    const first = { name: 'first-extension' };
    const second = { name: 'second-extension' };

    expect(
      createReactExtensionRegistry([
        first,
        null,
        undefined,
        false,
        0,
        '',
        second,
      ]),
    ).toEqual([first, second]);
  });
});
