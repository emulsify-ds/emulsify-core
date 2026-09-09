/**
 * @file AST parsing and binding helpers for Storybook story modules.
 */

import { extname } from 'node:path';
import { parse } from '@babel/parser';

const TWIG_SPECIFIER_PATTERN = /\.twig(?:\?.*)?$/;
const STORYBOOK_SPECIFIER = '@emulsify/core/storybook';
const VARIABLE_KINDS = new Set(['const', 'let', 'var']);

/**
 * Select Babel parser plugins for a story file.
 *
 * @param {string} filePath - Story file path.
 * @returns {string[]} Babel parser plugins.
 */
function parserPlugins(filePath) {
  const extension = extname(filePath).toLowerCase();

  if (extension === '.ts') return ['typescript'];
  if (extension === '.tsx') return ['jsx', 'typescript'];

  return ['jsx'];
}

/**
 * Visit every Babel AST node.
 *
 * @param {object} node - Current AST node.
 * @param {(node: object) => void} visitor - Node visitor.
 * @returns {void}
 */
function visitAst(node, visitor) {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') {
    return;
  }

  visitor(node);

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) visitAst(child, visitor);
    } else if (value && typeof value === 'object') {
      visitAst(value, visitor);
    }
  }
}

/**
 * Read a source line from a Babel node.
 *
 * @param {object} node - Babel AST node.
 * @returns {number} One-based source line.
 */
function nodeLine(node) {
  return node.loc?.start?.line || 1;
}

/**
 * Determine whether a module specifier references a Twig file.
 *
 * @param {unknown} value - Module specifier value.
 * @returns {boolean} TRUE when the value is a Twig module specifier.
 */
function isTwigSpecifier(value) {
  return typeof value === 'string' && TWIG_SPECIFIER_PATTERN.test(value);
}

/**
 * Read a Twig specifier from a require() initializer.
 *
 * @param {object} declarator - Babel variable declarator.
 * @returns {string} Twig specifier, or an empty string.
 */
export function requiredTwigSpecifier(declarator) {
  const init = declarator.init;

  if (
    declarator.id?.type !== 'Identifier' ||
    init?.type !== 'CallExpression' ||
    init.callee?.type !== 'Identifier' ||
    init.callee.name !== 'require' ||
    init.arguments.length !== 1 ||
    init.arguments[0]?.type !== 'StringLiteral' ||
    !isTwigSpecifier(init.arguments[0].value)
  ) {
    return '';
  }

  return init.arguments[0].value;
}

/**
 * Parse a Storybook story module without allowing syntax errors to escape.
 *
 * @param {string} source - Story source.
 * @param {string} [filePath=''] - Story file path.
 * @returns {{ast: object}|null} Parsed Babel AST, or null on failure.
 */
export function parseStoryModule(source, filePath = '') {
  try {
    const ast = parse(source, {
      sourceType: 'module',
      errorRecovery: true,
      plugins: parserPlugins(filePath),
    });

    return { ast };
  } catch {
    return null;
  }
}

/**
 * Find local bindings for imported or required Twig templates.
 *
 * @param {object} ast - Babel story module AST.
 * @returns {{name: string, specifier: string, line: number}[]} Twig bindings.
 */
export function findTwigTemplateBindings(ast) {
  const bindings = [];

  visitAst(ast, (node) => {
    if (
      node.type === 'ImportDeclaration' &&
      node.importKind !== 'type' &&
      isTwigSpecifier(node.source?.value)
    ) {
      for (const specifier of node.specifiers) {
        if (
          specifier.importKind !== 'type' &&
          (specifier.type === 'ImportDefaultSpecifier' ||
            specifier.type === 'ImportNamespaceSpecifier')
        ) {
          bindings.push({
            name: specifier.local.name,
            specifier: node.source.value,
            line: nodeLine(node),
          });
        }
      }
    }

    if (node.type === 'VariableDeclaration' && VARIABLE_KINDS.has(node.kind)) {
      for (const declarator of node.declarations) {
        const specifier = requiredTwigSpecifier(declarator);
        if (!specifier) continue;

        bindings.push({
          name: declarator.id.name,
          specifier,
          line: nodeLine(node),
        });
      }
    }
  });

  return bindings;
}

/**
 * Find local bindings for the public renderTwig named export.
 *
 * @param {object} ast - Babel story module AST.
 * @returns {Set<string>} Local renderTwig binding names.
 */
export function findRenderTwigBindings(ast) {
  const bindings = new Set();

  visitAst(ast, (node) => {
    if (
      node.type !== 'ImportDeclaration' ||
      node.source?.value !== STORYBOOK_SPECIFIER ||
      node.importKind === 'type'
    ) {
      return;
    }

    for (const specifier of node.specifiers) {
      if (
        specifier.type === 'ImportSpecifier' &&
        specifier.importKind !== 'type' &&
        specifier.imported?.name === 'renderTwig'
      ) {
        bindings.add(specifier.local.name);
      }
    }
  });

  return bindings;
}
