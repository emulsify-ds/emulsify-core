/**
 * @file Webpack require.context compatibility for Vite.
 *
 * Some existing Emulsify stories still use Webpack's static
 * `require.context()` helper to enumerate asset names. Vite does not define
 * `require` in browser modules, so this plugin rewrites static calls to
 * equivalent eager `import.meta.glob()` maps before import analysis runs.
 */

const REQUIRE_CONTEXT_PATTERN =
  /require\.context\(\s*(['"`])([^'"`]+)\1\s*,\s*(true|false)\s*,\s*\/((?:\\.|[^/\\])+)\/([dgimsuvy]*)\s*,?\s*\)/g;

const REQUIRE_CONTEXT_HELPER = `
const __emulsifyRequireContext = (modules, basePath, matcher) => {
  const normalizeKey = (key) => key.startsWith('./') ? key : \`./\${key}\`;
  const moduleKey = (key) => basePath + normalizeKey(key).slice(2);
  const context = (key) => modules[moduleKey(key)];

  context.keys = () =>
    Object.keys(modules)
      .map((key) => \`./\${key.slice(basePath.length)}\`)
      .filter((key) => matcher.test(key))
      .sort();
  context.resolve = (key) => moduleKey(key);
  context.id = basePath;

  return context;
};
`.trim();

/**
 * Determine whether a request is JavaScript-like source Vite should transform.
 *
 * @param {string} id - Vite module id.
 * @returns {boolean} TRUE when the id is transformable JavaScript source.
 */
const isJavaScriptRequest = (id) =>
  /\.[cm]?[jt]sx?(?:\?|$)/.test(id) && !id.includes('/node_modules/');

/**
 * Normalize a require.context directory argument for Vite glob keys.
 *
 * @param {string} request - Static directory request from require.context.
 * @returns {string} Directory request with a trailing slash.
 */
const normalizeBasePath = (request) => {
  if (request.endsWith('/')) return request;
  if (request === '.') return './';
  return `${request}/`;
};

/**
 * Build a focused glob tail for the common extension-only regex shape.
 *
 * @param {string} regexSource - Source from a JavaScript regex literal.
 * @returns {string} Glob tail.
 */
const globTailFromRegex = (regexSource) => {
  const singleExtension = regexSource.match(/^\\\.([A-Za-z0-9]+)\$$/);
  if (singleExtension) {
    return `*.${singleExtension[1]}`;
  }

  const extensionGroup = regexSource.match(/^\\\.\(([-A-Za-z0-9_|]+)\)\$$/);
  if (extensionGroup) {
    return `*.{${extensionGroup[1].replaceAll('|', ',')}}`;
  }

  return '*';
};

/**
 * Remove stateful regex flags so repeated matcher.test() calls stay stable.
 *
 * @param {string} flags - Flags from a JavaScript regex literal.
 * @returns {string} Non-stateful regex flags.
 */
const normalizeRegexFlags = (flags) => flags.replace(/[gy]/g, '');

/**
 * Transform static require.context calls into Vite import.meta.glob calls.
 *
 * @param {string} source - JavaScript source.
 * @returns {string|null} Transformed source, or null when unchanged.
 */
export function transformRequireContext(source) {
  const replacements = [];
  let match;

  REQUIRE_CONTEXT_PATTERN.lastIndex = 0;
  while ((match = REQUIRE_CONTEXT_PATTERN.exec(source))) {
    const [, , request, recursive, regexSource, regexFlags] = match;
    const basePath = normalizeBasePath(request);
    const globTail = globTailFromRegex(regexSource);
    const globPattern = `${basePath}${recursive === 'true' ? '**/' : ''}${globTail}`;
    const matcherFlags = normalizeRegexFlags(regexFlags);
    const replacement =
      '__emulsifyRequireContext(' +
      `import.meta.glob(${JSON.stringify(globPattern)}, { eager: true, import: 'default' }), ` +
      `${JSON.stringify(basePath)}, ` +
      `new RegExp(${JSON.stringify(regexSource)}, ${JSON.stringify(matcherFlags)})` +
      ')';

    replacements.push({
      end: REQUIRE_CONTEXT_PATTERN.lastIndex,
      replacement,
      start: match.index,
    });
  }

  if (!replacements.length) return null;

  let transformed = source;
  for (const { start, end, replacement } of replacements.reverse()) {
    transformed =
      transformed.slice(0, start) + replacement + transformed.slice(end);
  }

  return `${REQUIRE_CONTEXT_HELPER}\n\n${transformed}`;
}

/**
 * Rewrite static Webpack require.context calls for Vite-powered stories.
 *
 * @returns {import('vite').PluginOption} Vite plugin.
 */
export function requireContextCompatPlugin() {
  return {
    name: 'emulsify-require-context-compat',
    enforce: 'pre',
    transform(source, id) {
      if (!isJavaScriptRequest(id) || !source.includes('require.context')) {
        return null;
      }

      const code = transformRequireContext(source);
      return code ? { code, map: null } : null;
    },
  };
}
