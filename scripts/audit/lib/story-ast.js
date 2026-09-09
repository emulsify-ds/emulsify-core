/**
 * @file AST parsing and binding helpers for Storybook story modules.
 */

import { extname } from 'node:path';
import { parse } from '@babel/parser';

const TWIG_SPECIFIER_PATTERN = /\.twig(?:\?.*)?$/;
const STORYBOOK_SPECIFIER = '@emulsify/core/storybook';
const VARIABLE_KINDS = new Set(['const', 'let', 'var']);
const EXPRESSION_WRAPPERS = new Set([
  'ChainExpression',
  'ParenthesizedExpression',
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
  'TypeCastExpression',
]);

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

/**
 * Determine whether a value is a Babel AST node.
 *
 * @param {unknown} value - Possible AST node.
 * @returns {boolean} TRUE when the value is an AST node.
 */
export function isNode(value) {
  return Boolean(
    value && typeof value === 'object' && typeof value.type === 'string',
  );
}

/**
 * Remove transparent syntax wrappers from an expression.
 *
 * @param {object} node - Babel expression node.
 * @returns {object} Unwrapped expression.
 */
export function unwrapExpression(node) {
  let value = node;

  while (isNode(value) && EXPRESSION_WRAPPERS.has(value.type)) {
    value = value.expression;
  }

  return value;
}

/**
 * Get the module statements from a Babel File or Program.
 *
 * @param {object} ast - Babel File or Program.
 * @returns {object[]} Module statements.
 */
export function moduleBody(ast) {
  if (ast?.type === 'File') return ast.program?.body || [];
  if (ast?.type === 'Program') return ast.body || [];

  return [];
}

/**
 * Record module-scope function and variable declarations.
 *
 * @param {object} declaration - Babel declaration.
 * @param {Map<string, object>} declarations - Declaration map.
 * @returns {void}
 */
function addModuleDeclaration(declaration, declarations) {
  if (declaration?.type === 'FunctionDeclaration' && declaration.id?.name) {
    declarations.set(declaration.id.name, {
      node: declaration,
      value: declaration,
    });
    return;
  }

  if (declaration?.type !== 'VariableDeclaration') return;

  for (const declarator of declaration.declarations) {
    if (declarator.id?.type !== 'Identifier' || !declarator.init) continue;

    declarations.set(declarator.id.name, {
      node: declarator,
      value: declarator.init,
    });
  }
}

/**
 * Collect module-scope declarations by local name.
 *
 * @param {object} ast - Babel File or Program.
 * @returns {Map<string, object>} Module declaration map.
 */
export function collectModuleDeclarations(ast) {
  const declarations = new Map();

  for (const statement of moduleBody(ast)) {
    if (statement.type === 'ExportNamedDeclaration') {
      addModuleDeclaration(statement.declaration, declarations);
    } else {
      addModuleDeclaration(statement, declarations);
    }
  }

  return declarations;
}

/**
 * Read a static property name.
 *
 * @param {object} property - Babel object or member property.
 * @returns {string} Property name, or an empty string.
 */
export function staticPropertyName(property) {
  const key = property?.key || property?.property;

  if (key?.type === 'Identifier' && !property.computed) return key.name;
  if (key?.type === 'StringLiteral') return key.value;

  return '';
}

/**
 * Resolve identifier aliases to their module-scope value.
 *
 * @param {object} node - Babel expression.
 * @param {Map<string, object>} declarations - Module declaration map.
 * @param {Set<object>} [visited] - Values already resolved.
 * @returns {object} Resolved expression.
 */
export function resolveModuleValue(node, declarations, visited = new Set()) {
  const value = unwrapExpression(node);
  if (!isNode(value) || visited.has(value)) return value;
  visited.add(value);

  if (value.type === 'MemberExpression' && staticPropertyName(value)) {
    const property = readStaticProperty(
      value.object,
      staticPropertyName(value),
      declarations,
      visited,
    );
    return property.state === 'known'
      ? resolveModuleValue(property.node, declarations, visited)
      : value;
  }

  if (value.type !== 'Identifier' || !declarations.has(value.name)) {
    return value;
  }

  return resolveModuleValue(
    declarations.get(value.name).value,
    declarations,
    visited,
  );
}

/**
 * Read an imported or exported identifier name.
 *
 * @param {object} node - Babel identifier or string literal.
 * @returns {string} Static name, or an empty string.
 */
export function identifierName(node) {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type === 'StringLiteral') return node.value;

  return '';
}

/**
 * Read a property without assuming an unresolved spread or computed key is safe.
 *
 * @param {object} node - Object expression or module-local alias.
 * @param {string} name - Property name.
 * @param {Map<string, object>} declarations - Module declarations.
 * @param {Set<object>} [visited] - Values on the current alias path.
 * @returns {object} Known, absent, or unknown property and its source location.
 */
export function readStaticProperty(
  node,
  name,
  declarations,
  visited = new Set(),
) {
  if (!node) return { state: 'absent' };
  const value = resolveModuleValue(node, declarations, visited);
  if (value?.type !== 'ObjectExpression') return { state: 'unknown' };

  for (let index = value.properties.length - 1; index >= 0; index -= 1) {
    const property = value.properties[index];
    const key = staticPropertyName(property);
    if (property.type === 'SpreadElement' || !key) {
      return { state: 'unknown' };
    }
    if (key !== name) continue;
    if (property.type === 'ObjectProperty') {
      return { state: 'known', node: property.value, lineNode: property };
    }
    if (property.type === 'ObjectMethod' && property.kind === 'method') {
      return { state: 'known', node: property, lineNode: property };
    }
    return { state: 'unknown' };
  }

  return { state: 'absent' };
}
