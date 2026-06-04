/**
 * @file Tests for YAML module plugin exports and request handling.
 */

import { join } from 'path';

import { yamlModulePlugin } from '../yaml-module.js';

const projectDir = '/tmp/emulsify-core-yaml-plugin-test';

describe('YAML module plugin', () => {
  it('transforms YAML imports into JavaScript modules with default and named exports', () => {
    const yamlPlugin = yamlModulePlugin();
    const result = yamlPlugin.transform(
      [
        'name: Accordion',
        'props:',
        '  type: object',
        'slots:',
        '  content:',
        '    title: Content',
        '$schema: https://example.com/schema.json',
        'invalid-key: omitted',
        'default: reserved',
      ].join('\n'),
      `${join(projectDir, 'src/components/accordion/accordion.component.yml')}?import`,
    );

    expect(result).toEqual({
      code: [
        'export const name = "Accordion";',
        'export const props = {"type":"object"};',
        'export const slots = {"content":{"title":"Content"}};',
        'export default {"name":"Accordion","props":{"type":"object"},"slots":{"content":{"title":"Content"}},"$schema":"https://example.com/schema.json","invalid-key":"omitted","default":"reserved"};',
        '',
      ].join('\n'),
      map: null,
    });
    expect(result.code).not.toContain('export const $schema');
    expect(result.code).not.toContain('export const invalid-key');
    expect(result.code).not.toContain('export const default');
  });

  it('preserves default-only YAML modules for non-object values', () => {
    const yamlPlugin = yamlModulePlugin();

    expect(
      yamlPlugin.transform(
        ['- one', '- two'].join('\n'),
        join(projectDir, 'src/components/list/list.component.yml'),
      ),
    ).toEqual({
      code: 'export default ["one","two"];\n',
      map: null,
    });
  });

  it('ignores raw and URL YAML requests', () => {
    const yamlPlugin = yamlModulePlugin();
    const id = join(projectDir, 'src/components/card/card.component.yml');

    expect(yamlPlugin.transform('name: Raw', `${id}?raw`)).toBeNull();
    expect(yamlPlugin.transform('name: Url', `${id}?url`)).toBeNull();
  });
});
