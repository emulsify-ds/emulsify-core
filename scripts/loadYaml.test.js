import loadYaml from './loadYaml';

describe('loadYaml', () => {
  it('can load a yaml file, parse it, and return it', () => {
    expect.assertions(1);
    expect(loadYaml('./loadYaml.fixture.yml')).toEqual({
      the: 'yaml spaghetti and meatballs',
    });
  });
});
