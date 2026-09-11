/**
 * @file Select statically readable CSF story exports without executing modules.
 */

import {
  identifierName,
  moduleBody,
  resolveModuleValue,
  readStaticProperty,
  unwrapExpression,
} from './story-ast.js';

const RESERVED_EXPORTS = new Set([
  'default',
  '__esModule',
  '__namedExportsOrder',
]);

/**
 * Recognize literal falsy values used by CSF filter and render defaults.
 *
 * @param {object} node - Babel expression.
 * @param {Map<string, object>} declarations - Module declarations.
 * @returns {boolean} TRUE only for a statically known falsy value.
 */
export function isStaticFalsy(node, declarations) {
  const value = resolveModuleValue(node, declarations);
  if (value?.type === 'NullLiteral') return true;
  if (
    ['BooleanLiteral', 'NumericLiteral', 'StringLiteral'].includes(value?.type)
  ) {
    return !value.value;
  }
  return (
    value?.type === 'Identifier' &&
    value.name === 'undefined' &&
    !declarations.has('undefined')
  );
}

/**
 * Decode supported CSF filters; dynamic expressions retain an unknown state.
 *
 * @param {object} property - Static property lookup.
 * @param {Map<string, object>} declarations - Module declarations.
 * @returns {object} Absent, known array/regex, or unknown filter.
 */
function readFilter(property, declarations) {
  if (property.state !== 'known') return property;
  const value = resolveModuleValue(property.node, declarations);
  if (isStaticFalsy(value, declarations)) return { state: 'absent' };

  if (value?.type === 'ArrayExpression') {
    const elements = value.elements.map(unwrapExpression);
    if (elements.every((element) => element?.type === 'StringLiteral')) {
      return {
        state: 'known',
        strings: elements.map((element) => element.value),
      };
    }
  }
  if (value?.type === 'RegExpLiteral') {
    try {
      return {
        state: 'known',
        regex: new RegExp(value.pattern, value.flags),
      };
    } catch {
      // A newer RegExp syntax may parse but be unsupported by this Node version.
    }
  }
  return { state: 'unknown' };
}

/**
 * Match the Storybook CSF array/regex contract, with no shared RegExp cursor.
 *
 * @param {string} name - Exported name, rather than a local binding or story name.
 * @param {object} filter - Decoded static filter.
 * @returns {boolean|null} Match, mismatch, or unknown.
 */
function matchesFilter(name, filter) {
  if (filter.state === 'unknown') return null;
  if (filter.strings) return filter.strings.includes(name);
  // Storybook's isExportStory uses String.match(). A fresh expression also keeps
  // sticky filters from changing the result when another export was checked.
  return Boolean(
    name.match(new RegExp(filter.regex.source, filter.regex.flags)),
  );
}

/**
 * Collect named exports and default metadata before selecting any render paths.
 *
 * @param {object} ast - Babel File or Program.
 * @returns {object} Metadata, candidates, and unresolved re-export state.
 */
function collectExports(ast) {
  let metadata;
  let hasUnknownExports = false;
  const candidates = [];
  for (const statement of moduleBody(ast)) {
    if (statement.exportKind === 'type') continue;
    if (statement.type === 'ExportDefaultDeclaration') {
      metadata = statement.declaration;
      continue;
    }
    if (statement.type === 'ExportAllDeclaration') {
      hasUnknownExports = true;
      continue;
    }
    if (statement.type !== 'ExportNamedDeclaration') continue;
    const declaration = statement.declaration;
    if (declaration?.declare) continue;
    if (declaration?.type === 'FunctionDeclaration' && declaration.id) {
      candidates.push({
        name: declaration.id.name,
        node: declaration,
        lineNode: declaration,
      });
    } else if (declaration?.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        if (declarator.id?.type !== 'Identifier') {
          hasUnknownExports = true;
          continue;
        }
        candidates.push({
          name: declarator.id.name,
          node: declarator.init,
          lineNode: declarator,
        });
      }
    }
    for (const specifier of statement.specifiers) {
      if (specifier.exportKind === 'type') continue;
      const name = identifierName(specifier.exported);
      if (name === 'default') {
        metadata = statement.source ? statement : specifier.local;
      } else if (name) {
        candidates.push({
          name,
          node: statement.source ? null : specifier.local,
          lineNode: specifier,
        });
      }
    }
  }
  return { metadata, candidates, hasUnknownExports };
}

/**
 * Apply includeStories and excludeStories before resolving effective renders.
 *
 * Unknown filters keep possible stories in the analysis, but a known exclusion
 * (or a known inclusion mismatch) can still rule a candidate out. No module is
 * imported and no call, getter, or arbitrary expression is evaluated.
 *
 * @param {object} ast - Babel File or Program.
 * @param {Map<string, object>} declarations - Module declarations.
 * @returns {object} Selected candidates, default render, and selection certainty.
 */
export function selectStoryExports(ast, declarations) {
  const { metadata, candidates, hasUnknownExports } = collectExports(ast);
  const include = readFilter(
    readStaticProperty(metadata, 'includeStories', declarations),
    declarations,
  );
  const exclude = readFilter(
    readStaticProperty(metadata, 'excludeStories', declarations),
    declarations,
  );
  const stories = [];
  let hasUnknownSelection = hasUnknownExports;
  for (const candidate of candidates) {
    if (RESERVED_EXPORTS.has(candidate.name)) continue;
    const included =
      include.state === 'absent' || matchesFilter(candidate.name, include);
    const excluded =
      exclude.state !== 'absent' && matchesFilter(candidate.name, exclude);
    // Storybook requires inclusion and no exclusion; an exclusion always wins.
    if (included === false || excluded === true) continue;
    if (included === null || excluded === null) hasUnknownSelection = true;
    stories.push(candidate);
  }
  return {
    stories,
    defaultRender: readStaticProperty(metadata, 'render', declarations),
    hasUnknownSelection,
  };
}
