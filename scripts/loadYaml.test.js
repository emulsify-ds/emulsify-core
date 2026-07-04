/**
 * @file Tests for the synchronous YAML loader.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { load as parseYaml } from 'js-yaml';

import loadYaml from './loadYaml';

describe('loadYaml', () => {
  it('loads a yaml file through the shared js-yaml parser', () => {
    // The fixture is intentionally tiny so failures point to loader behavior.
    const fixturePath = resolve(process.cwd(), 'scripts/loadYaml.fixture.yml');

    expect.assertions(2);
    expect(loadYaml('./loadYaml.fixture.yml')).toEqual({
      the: 'yaml spaghetti and meatballs',
    });
    expect(loadYaml('./loadYaml.fixture.yml')).toEqual(
      parseYaml(readFileSync(fixturePath, 'utf8')),
    );
  });
});
