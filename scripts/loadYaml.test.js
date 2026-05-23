/**
 * @file Tests for the synchronous YAML loader.
 */

import loadYaml from './loadYaml';

describe('loadYaml', () => {
  it('can load a yaml file, parse it, and return it', () => {
    // The fixture is intentionally tiny so failures point to loader behavior.
    expect.assertions(1);
    expect(loadYaml('./loadYaml.fixture.yml')).toEqual({
      the: 'yaml spaghetti and meatballs',
    });
  });
});
