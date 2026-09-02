/**
 * @file Tests for Storybook story AST helpers.
 */

import {
  findRenderTwigBindings,
  findTwigTemplateBindings,
  parseStoryModule,
} from '../story-ast.js';

/**
 * Parse a story fixture and return its AST.
 *
 * @param {string} source - Story module source.
 * @param {string} [filePath='fixture.stories.js'] - Fixture file path.
 * @returns {object} Parsed Babel AST.
 */
function parseAst(source, filePath = 'fixture.stories.js') {
  const result = parseStoryModule(source, filePath);

  expect(result).toEqual({ ast: expect.any(Object) });

  return result.ast;
}

describe('parseStoryModule', () => {
  it.each([
    ['JavaScript', 'card.stories.js'],
    ['JSX', 'card.stories.jsx'],
    ['an empty file path', ''],
    ['an unknown extension', 'card.stories.unknown'],
  ])('parses JSX for %s', (_label, filePath) => {
    const ast = parseAst('export default <Card />;', filePath);

    expect(ast.program.body[0]).toMatchObject({
      type: 'ExportDefaultDeclaration',
      declaration: { type: 'JSXElement' },
    });
  });

  it('parses TypeScript syntax in .ts files', () => {
    const ast = parseAst('const count: number = 1;', 'card.stories.ts');

    expect(ast.program.body[0]).toMatchObject({
      type: 'VariableDeclaration',
      loc: { start: { line: 1 } },
    });
  });

  it('parses JSX and type annotations together in .tsx files', () => {
    const ast = parseAst(
      [
        'type Props = { label: string };',
        'export const Card = ({ label }: Props) => <article>{label}</article>;',
      ].join('\n'),
      'card.stories.tsx',
    );

    expect(ast.program.body).toEqual([
      expect.objectContaining({
        type: 'TSTypeAliasDeclaration',
        loc: expect.objectContaining({
          start: expect.objectContaining({ line: 1 }),
        }),
      }),
      expect.objectContaining({
        type: 'ExportNamedDeclaration',
        loc: expect.objectContaining({
          start: expect.objectContaining({ line: 2 }),
        }),
      }),
    ]);
    expect(ast.program.body[1].declaration.declarations[0].init.body.type).toBe(
      'JSXElement',
    );
  });

  it('returns an AST for parser errors recoverable with errorRecovery', () => {
    const ast = parseAst(
      ['const duplicate = 1;', 'const duplicate = 2;'].join('\n'),
    );

    expect(ast.errors).toHaveLength(1);
    expect(ast.errors[0]).toMatchObject({
      reasonCode: 'VarRedeclaration',
      loc: { line: 2 },
    });
  });

  it('returns null instead of throwing for unrecoverable syntax', () => {
    expect(
      parseStoryModule('export default {', 'broken.stories.js'),
    ).toBeNull();
  });
});

describe('findTwigTemplateBindings', () => {
  it('finds default and namespace Twig imports with source lines', () => {
    const ast = parseAst(
      [
        'import cardTwig from "./card.twig";',
        'import * as iconTwig from "./icon.twig?raw";',
        'import type typeTwig from "./type.twig";',
        'import { macro as namedTwig } from "./named.twig";',
        'import script from "./card.js";',
      ].join('\n'),
      'fixture.stories.ts',
    );

    expect(findTwigTemplateBindings(ast)).toEqual([
      { name: 'cardTwig', specifier: './card.twig', line: 1 },
      { name: 'iconTwig', specifier: './icon.twig?raw', line: 2 },
    ]);
  });

  it('finds const, let, and var Twig require bindings with source lines', () => {
    const ast = parseAst(
      [
        'const cardTwig = require("./card.twig");',
        'let iconTwig = require("./icon.twig?source");',
        'var itemTwig = require("../item.html.twig");',
      ].join('\n'),
    );

    expect(findTwigTemplateBindings(ast)).toEqual([
      { name: 'cardTwig', specifier: './card.twig', line: 1 },
      { name: 'iconTwig', specifier: './icon.twig?source', line: 2 },
      { name: 'itemTwig', specifier: '../item.html.twig', line: 3 },
    ]);
  });

  it('ignores unsupported Twig-like bindings', () => {
    const ast = parseAst(
      [
        'const dynamicTwig = require(templatePath);',
        'const propertyTwig = require("./property.twig").default;',
        'const loadedTwig = load("./loaded.twig");',
        'const script = require("./script.js");',
      ].join('\n'),
    );

    expect(findTwigTemplateBindings(ast)).toEqual([]);
  });
});

describe('findRenderTwigBindings', () => {
  it('finds direct and aliased imports from the public Storybook entry', () => {
    const ast = parseAst(
      [
        'import {',
        '  renderTwig,',
        '  renderTwig as rt,',
        '  renderWebComponent,',
        '} from "@emulsify/core/storybook";',
      ].join('\n'),
    );

    expect(findRenderTwigBindings(ast)).toEqual(new Set(['renderTwig', 'rt']));
  });

  it('ignores bare, internal, default, and similarly named imports', () => {
    const ast = parseAst(
      [
        'import { renderTwig as bare } from "@emulsify/core";',
        'import { renderTwig as internal } from "@emulsify/core/storybook/render-twig";',
        'import defaultHelper from "@emulsify/core/storybook";',
        'import { renderTwigish } from "@emulsify/core/storybook";',
        'import type { renderTwig as typeOnly } from "@emulsify/core/storybook";',
      ].join('\n'),
      'fixture.stories.ts',
    );

    expect(findRenderTwigBindings(ast)).toEqual(new Set());
  });
});
