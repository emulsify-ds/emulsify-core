/**
 * @file Classify modern and legacy Twig render paths in Storybook stories.
 */

const EXPRESSION_WRAPPERS = new Set([
  'ChainExpression',
  'ParenthesizedExpression',
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
  'TypeCastExpression',
]);
const FUNCTION_TYPES = new Set([
  'ArrowFunctionExpression',
  'ClassMethod',
  'ClassPrivateMethod',
  'FunctionDeclaration',
  'FunctionExpression',
  'ObjectMethod',
]);
const SHADOWED_BINDING = Symbol('shadowed binding');

/**
 * Determine whether a value is a Babel AST node.
 *
 * @param {unknown} value - Possible AST node.
 * @returns {boolean} TRUE when the value is an AST node.
 */
function isNode(value) {
  return Boolean(
    value && typeof value === 'object' && typeof value.type === 'string',
  );
}

/**
 * Return direct AST children for a node.
 *
 * @param {object} node - Babel AST node.
 * @returns {object[]} Direct child nodes.
 */
function childNodes(node) {
  const children = [];

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      children.push(...value.filter(isNode));
    } else if (isNode(value)) {
      children.push(value);
    }
  }

  return children;
}

/**
 * Remove transparent syntax wrappers from an expression.
 *
 * @param {object} node - Babel expression node.
 * @returns {object} Unwrapped expression.
 */
function unwrapExpression(node) {
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
function moduleBody(ast) {
  if (ast?.type === 'File') return ast.program?.body || [];
  if (ast?.type === 'Program') return ast.body || [];

  return [];
}

/**
 * Get a one-based source line for a node.
 *
 * @param {object} node - Babel AST node.
 * @returns {number} One-based line number.
 */
function nodeLine(node) {
  return Number.isInteger(node?.loc?.start?.line) ? node.loc.start.line : 1;
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
function collectModuleDeclarations(ast) {
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
function staticPropertyName(property) {
  const key = property?.key || property?.property;

  if (key?.type === 'Identifier' && !property.computed) return key.name;
  if (key?.type === 'StringLiteral') return key.value;

  return '';
}

/**
 * Read an object's effective render property.
 *
 * @param {object} objectExpression - Babel object expression.
 * @returns {{node: object, lineNode: object}|null} Render value and location.
 */
function objectRenderValue(objectExpression) {
  for (
    let index = objectExpression.properties.length - 1;
    index >= 0;
    index -= 1
  ) {
    const property = objectExpression.properties[index];
    if (staticPropertyName(property) !== 'render') continue;

    if (property.type === 'ObjectMethod') {
      return { node: property, lineNode: property };
    }

    if (property.type === 'ObjectProperty') {
      return { node: property.value, lineNode: property };
    }
  }

  return null;
}

/**
 * Determine whether a call uses Function.prototype.bind().
 *
 * @param {object} node - Babel expression.
 * @returns {boolean} TRUE for X.bind(...).
 */
function isBindCall(node) {
  return (
    node?.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    staticPropertyName(node.callee) === 'bind'
  );
}

/**
 * Resolve identifier aliases to their module-scope value.
 *
 * @param {object} node - Babel expression.
 * @param {Map<string, object>} declarations - Module declaration map.
 * @param {Set<object>} [visited] - Values already resolved.
 * @returns {object} Resolved expression.
 */
function resolveModuleValue(node, declarations, visited = new Set()) {
  const value = unwrapExpression(node);
  if (!isNode(value) || visited.has(value)) return value;
  visited.add(value);

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
 * Resolve one story value to its effective render path.
 *
 * @param {object} node - Story value.
 * @param {Map<string, object>} declarations - Module declaration map.
 * @param {object} [lineNode] - Preferred source location.
 * @param {Set<object>} [visited] - Nodes already resolved.
 * @returns {{node: object, lineNode: object}|null} Render path.
 */
function resolveRenderPath(
  node,
  declarations,
  lineNode = null,
  visited = new Set(),
) {
  const value = unwrapExpression(node);
  if (!isNode(value) || visited.has(value)) return null;
  visited.add(value);

  if (value.type === 'Identifier' && declarations.has(value.name)) {
    const declaration = declarations.get(value.name);
    return resolveRenderPath(
      declaration.value,
      declarations,
      declaration.node,
      visited,
    );
  }

  if (isBindCall(value)) {
    return resolveRenderPath(
      value.callee.object,
      declarations,
      lineNode,
      visited,
    );
  }

  if (value.type === 'ObjectExpression') {
    const renderValue = objectRenderValue(value);
    if (!renderValue) return null;

    return resolveRenderPath(
      renderValue.node,
      declarations,
      renderValue.lineNode,
      visited,
    );
  }

  return { node: value, lineNode: lineNode || value };
}

/**
 * Determine whether a named export is story-like.
 *
 * Lower-camel exports are treated as module helpers rather than CSF stories.
 *
 * @param {string} name - Exported name.
 * @returns {boolean} TRUE when the export can be a story render path.
 */
function isStoryExportName(name) {
  return typeof name === 'string' && /^[A-Z]/.test(name);
}

/**
 * Read an imported or exported identifier name.
 *
 * @param {object} node - Babel identifier or string literal.
 * @returns {string} Static name, or an empty string.
 */
function identifierName(node) {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type === 'StringLiteral') return node.value;

  return '';
}

/**
 * Enumerate explicit Storybook render paths.
 *
 * @param {object} ast - Babel File or Program.
 * @param {Map<string, object>} declarations - Module declaration map.
 * @returns {{node: object, lineNode: object}[]} Render paths.
 */
function collectStoryRenderPaths(ast, declarations) {
  const paths = [];
  const addPath = (value, lineNode = null) => {
    const path = resolveRenderPath(value, declarations, lineNode);
    if (!path) return;

    paths.push(path);
  };

  for (const statement of moduleBody(ast)) {
    if (statement.type === 'ExportDefaultDeclaration') {
      const meta = resolveModuleValue(statement.declaration, declarations);
      if (meta?.type === 'ObjectExpression') {
        const renderValue = objectRenderValue(meta);
        if (renderValue) addPath(renderValue.node, renderValue.lineNode);
      }
      continue;
    }

    if (statement.type !== 'ExportNamedDeclaration') continue;

    const declaration = statement.declaration;
    if (declaration?.type === 'FunctionDeclaration') {
      if (isStoryExportName(declaration.id?.name)) {
        addPath(declaration, declaration);
      }
    } else if (declaration?.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        if (isStoryExportName(declarator.id?.name) && declarator.init) {
          addPath(declarator.init, declarator);
        }
      }
    }

    if (statement.source) continue;
    for (const specifier of statement.specifiers) {
      const exportedName = identifierName(specifier.exported);
      if (!isStoryExportName(exportedName)) continue;

      addPath(specifier.local, specifier);
    }
  }

  return paths;
}

/**
 * Add identifiers declared by a binding pattern to a scope.
 *
 * @param {object} pattern - Babel binding pattern.
 * @param {Map<string, unknown>} bindings - Scope binding map.
 * @param {unknown} value - Value associated with a simple identifier.
 * @returns {void}
 */
function addPatternBindings(pattern, bindings, value = SHADOWED_BINDING) {
  if (!isNode(pattern)) return;

  if (pattern.type === 'Identifier') {
    bindings.set(pattern.name, value);
    return;
  }

  if (pattern.type === 'AssignmentPattern') {
    addPatternBindings(pattern.left, bindings, value);
    return;
  }

  if (pattern.type === 'RestElement') {
    addPatternBindings(pattern.argument, bindings, value);
    return;
  }

  if (pattern.type === 'ObjectPattern') {
    for (const property of pattern.properties) {
      if (property.type === 'RestElement') {
        addPatternBindings(property.argument, bindings, value);
      } else {
        addPatternBindings(property.value, bindings, value);
      }
    }
    return;
  }

  if (pattern.type === 'ArrayPattern') {
    for (const element of pattern.elements) {
      addPatternBindings(element, bindings, value);
    }
  }
}

/**
 * Collect declarations owned directly by a block scope.
 *
 * @param {object} block - Babel block statement.
 * @returns {Map<string, unknown>} Block binding map.
 */
function collectBlockBindings(block) {
  const bindings = new Map();

  for (const statement of block.body || []) {
    if (statement.type === 'VariableDeclaration') {
      for (const declarator of statement.declarations) {
        if (declarator.id?.type === 'Identifier') {
          bindings.set(declarator.id.name, declarator.init || SHADOWED_BINDING);
        } else {
          addPatternBindings(declarator.id, bindings);
        }
      }
    } else if (
      (statement.type === 'FunctionDeclaration' ||
        statement.type === 'ClassDeclaration') &&
      statement.id?.name
    ) {
      bindings.set(statement.id.name, statement);
    }
  }

  return bindings;
}

/**
 * Collect function parameters and its local name as lexical bindings.
 *
 * @param {object} functionNode - Babel function node.
 * @returns {Map<string, unknown>} Function binding map.
 */
function collectFunctionBindings(functionNode) {
  const bindings = new Map();

  if (functionNode.id?.name) {
    bindings.set(functionNode.id.name, functionNode);
  }
  for (const parameter of functionNode.params || []) {
    addPatternBindings(parameter, bindings);
  }

  return bindings;
}

/**
 * Find a name in a chain of local lexical scopes.
 *
 * @param {string} name - Identifier name.
 * @param {Map<string, unknown>[]} scopes - Innermost-first scope chain.
 * @returns {{found: boolean, value: unknown}} Binding lookup result.
 */
function findLocalBinding(name, scopes) {
  for (const scope of scopes) {
    if (scope.has(name)) return { found: true, value: scope.get(name) };
  }

  return { found: false, value: null };
}

/**
 * Visit an AST with innermost-first lexical scope maps.
 *
 * @param {object} node - Current Babel AST node.
 * @param {Map<string, unknown>[]} scopes - Current scope chain.
 * @param {(node: object, scopes: Map<string, unknown>[]) => void} visitor
 * Scoped node visitor.
 * @returns {void}
 */
function visitScopedAst(node, scopes, visitor) {
  if (!isNode(node)) return;
  visitor(node, scopes);

  if (isFunctionNode(node)) {
    const functionScopes = [collectFunctionBindings(node), ...scopes];
    for (const parameter of node.params || []) {
      visitScopedAst(parameter, functionScopes, visitor);
    }
    visitScopedAst(node.body, functionScopes, visitor);
    return;
  }

  if (node.type === 'BlockStatement') {
    const blockScopes = [collectBlockBindings(node), ...scopes];
    for (const statement of node.body) {
      visitScopedAst(statement, blockScopes, visitor);
    }
    return;
  }

  if (node.type === 'CatchClause') {
    const bindings = new Map();
    addPatternBindings(node.param, bindings);
    visitScopedAst(node.body, [bindings, ...scopes], visitor);
    return;
  }

  for (const child of childNodes(node)) {
    visitScopedAst(child, scopes, visitor);
  }
}

/**
 * Mark renderTwig calls, their arguments, and resolved helpers as modern.
 *
 * @param {object} ast - Babel File or Program.
 * @param {Map<string, object>} declarations - Module declaration map.
 * @param {Set<string>} renderTwigNames - Local renderTwig binding names.
 * @returns {Set<object>} Modern AST nodes.
 */
function collectModernNodes(ast, declarations, renderTwigNames) {
  const modernNodes = new Set();
  const visitedDeclarations = new Set();

  const markSubtree = (node, scopes = []) => {
    visitScopedAst(node, scopes, (current, currentScopes) => {
      modernNodes.add(current);

      if (current.type !== 'Identifier') return;
      if (findLocalBinding(current.name, currentScopes).found) return;

      const declaration = declarations.get(current.name);
      if (!declaration || visitedDeclarations.has(declaration.node)) return;

      visitedDeclarations.add(declaration.node);
      modernNodes.add(declaration.node);
      markSubtree(declaration.value);
    });
  };

  visitScopedAst(ast, [], (node, scopes) => {
    const callee = unwrapExpression(node.callee);
    if (
      node.type !== 'CallExpression' ||
      callee?.type !== 'Identifier' ||
      !renderTwigNames.has(callee.name) ||
      findLocalBinding(callee.name, scopes).found
    ) {
      return;
    }

    modernNodes.add(node);
    for (const argument of node.arguments) markSubtree(argument, scopes);
  });

  return modernNodes;
}

/**
 * Determine whether a node is a function-like render value.
 *
 * @param {object} node - Babel AST node.
 * @returns {boolean} TRUE for supported function nodes.
 */
function isFunctionNode(node) {
  return FUNCTION_TYPES.has(node?.type);
}

/**
 * Resolve a local or module binding value.
 *
 * @param {string} name - Identifier name.
 * @param {Map<string, unknown>[]} localScopes - Function-local scopes.
 * @param {Map<string, object>} declarations - Module declarations.
 * @returns {{found: boolean, local: boolean, value: unknown}} Binding result.
 */
function boundValue(name, localScopes, declarations) {
  const local = findLocalBinding(name, localScopes);
  if (local.found) return { ...local, local: true };

  if (declarations.has(name)) {
    return {
      found: true,
      local: false,
      value: declarations.get(name).value,
    };
  }

  return { found: false, local: false, value: null };
}

/**
 * Find a Twig template evaluated by a returned value.
 *
 * @param {object} node - Returned expression or nested callback.
 * @param {object} context - Classification context.
 * @param {Map<string, unknown>[]} localScopes - Function-local scopes.
 * @param {Set<object>} visited - Values already followed.
 * @returns {string} Twig binding name, or an empty string.
 */
function findTwigInValue(node, context, localScopes, visited) {
  const value = unwrapExpression(node);
  if (!isNode(value) || visited.has(value) || context.modernNodes.has(value)) {
    return '';
  }
  visited.add(value);

  if (isFunctionNode(value)) {
    return findFunctionTwigReturn(value, context, localScopes);
  }

  if (value.type === 'Identifier') {
    const binding = boundValue(value.name, localScopes, context.declarations);
    if (binding.found) {
      if (!isNode(binding.value)) return '';

      return findTwigInValue(
        binding.value,
        context,
        binding.local ? localScopes : [],
        visited,
      );
    }

    return context.templateNames.has(value.name) ? value.name : '';
  }

  if (value.type === 'CallExpression') {
    const callee = unwrapExpression(value.callee);
    if (callee?.type === 'Identifier') {
      const binding = boundValue(
        callee.name,
        localScopes,
        context.declarations,
      );
      if (binding.found && isNode(binding.value)) {
        const name = findTwigInValue(
          binding.value,
          context,
          binding.local ? localScopes : [],
          visited,
        );
        if (name) return name;
      } else if (!binding.found && context.templateNames.has(callee.name)) {
        return callee.name;
      }
    }

    for (const argument of value.arguments) {
      const name = findTwigInValue(argument, context, localScopes, visited);
      if (name) return name;
    }

    return '';
  }

  for (const child of childNodes(value)) {
    const name = findTwigInValue(child, context, localScopes, visited);
    if (name) return name;
  }

  return '';
}

/**
 * Find a Twig-returning statement without crossing a nested function boundary.
 *
 * @param {object} node - Current statement or expression.
 * @param {object} context - Classification context.
 * @param {Map<string, unknown>[]} localScopes - Current lexical scopes.
 * @returns {string} Twig binding name, or an empty string.
 */
function findTwigReturnInNode(node, context, localScopes) {
  if (!isNode(node) || isFunctionNode(node)) return '';

  if (node.type === 'BlockStatement') {
    const blockScopes = [collectBlockBindings(node), ...localScopes];
    for (const statement of node.body) {
      const name = findTwigReturnInNode(statement, context, blockScopes);
      if (name) return name;
    }
    return '';
  }

  if (node.type === 'CatchClause') {
    const bindings = new Map();
    addPatternBindings(node.param, bindings);
    return findTwigReturnInNode(node.body, context, [bindings, ...localScopes]);
  }

  if (node.type === 'ReturnStatement' && node.argument) {
    return findTwigInValue(node.argument, context, localScopes, new Set());
  }

  for (const child of childNodes(node)) {
    const name = findTwigReturnInNode(child, context, localScopes);
    if (name) return name;
  }

  return '';
}

/**
 * Find a Twig template returned by a function render path.
 *
 * @param {object} functionNode - Babel function node.
 * @param {object} context - Classification context.
 * @param {Map<string, unknown>[]} [parentScopes] - Enclosing local scopes.
 * @returns {string} Twig binding name, or an empty string.
 */
function findFunctionTwigReturn(functionNode, context, parentScopes = []) {
  if (context.visitedFunctions.has(functionNode)) return '';
  context.visitedFunctions.add(functionNode);

  const body = unwrapExpression(functionNode.body);
  const localScopes = [collectFunctionBindings(functionNode), ...parentScopes];

  if (
    functionNode.type === 'ArrowFunctionExpression' &&
    body?.type !== 'BlockStatement'
  ) {
    return findTwigInValue(body, context, localScopes, new Set());
  }

  return findTwigReturnInNode(body, context, localScopes);
}

/**
 * Classify explicit Storybook render paths that return Twig HTML directly.
 *
 * @param {object} ast - Babel File or Program.
 * @param {object} options - Binding names used by the story module.
 * @param {Iterable<string>} options.templateNames - Twig template bindings.
 * @param {Iterable<string>} options.renderTwigNames - renderTwig bindings.
 * @returns {{legacy: {name: string, line: number}[], hasStoryRenderPath: boolean}}
 * Render path classification.
 */
export function classifyStoryRenderPaths(
  ast,
  { templateNames = [], renderTwigNames = [] } = {},
) {
  const declarations = collectModuleDeclarations(ast);
  const templateNameSet = new Set(templateNames);
  const renderTwigNameSet = new Set(renderTwigNames);
  const modernNodes = collectModernNodes(ast, declarations, renderTwigNameSet);
  const paths = collectStoryRenderPaths(ast, declarations);
  const legacy = [];

  for (const path of paths) {
    if (modernNodes.has(path.node)) continue;

    const context = {
      declarations,
      modernNodes,
      templateNames: templateNameSet,
      visitedFunctions: new Set(),
    };
    const name = findTwigInValue(path.node, context, [], new Set());
    if (name) legacy.push({ name, line: nodeLine(path.lineNode) });
  }

  return {
    legacy,
    hasStoryRenderPath: paths.length > 0,
  };
}
