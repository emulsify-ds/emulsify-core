/**
 * @file Webpack require.context compatibility for Vite.
 *
 * Some existing Emulsify stories still use Webpack's static
 * `require.context()` helper to enumerate asset names. Vite does not define
 * `require` in browser modules, so this plugin rewrites static calls to
 * equivalent eager `import.meta.glob()` maps before import analysis runs.
 */

import { existsSync, readdirSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import { toPosixPath } from '../utils/paths.js';

const REQUIRE_CONTEXT_PATTERN =
  /require\.context\(\s*(['"`])([^'"`]+)\1\s*,\s*(true|false)\s*,\s*\/((?:\\.|[^/\\])+)\/([dgimsuvy]*)\s*,?\s*\)/g;
const STATIC_ASSET_CONTEXT_EXTS = new Set([
  'avif',
  'eot',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'otf',
  'pdf',
  'png',
  'svg',
  'ttf',
  'webp',
  'woff',
  'woff2',
]);

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

const __emulsifyRequireContextFromKeys = (keys, basePath, publicBasePath) => {
  const normalizedKeys = keys.slice().sort();
  const keySet = new Set(normalizedKeys);
  const normalizeKey = (key) => key.startsWith('./') ? key : \`./\${key}\`;
  const moduleKey = (key) => basePath + normalizeKey(key).slice(2);
  const publicKey = (key) =>
    publicBasePath ? publicBasePath + normalizeKey(key).slice(2) : moduleKey(key);
  const context = (key) => keySet.has(normalizeKey(key)) ? publicKey(key) : undefined;

  context.keys = () => normalizedKeys.slice();
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
 * Extract extension names from regexes that can be represented by a file glob.
 *
 * @param {string} regexSource - Source from a JavaScript regex literal.
 * @returns {string[]} Lowercase extension names.
 */
const extensionsFromRegex = (regexSource) => {
  const singleExtension = regexSource.match(/^\\\.([A-Za-z0-9]+)\$$/);
  if (singleExtension) {
    return [singleExtension[1].toLowerCase()];
  }

  const extensionGroup = regexSource.match(/^\\\.\(([-A-Za-z0-9_|]+)\)\$$/);
  if (extensionGroup) {
    return extensionGroup[1]
      .split('|')
      .filter(Boolean)
      .map((extension) => extension.toLowerCase());
  }

  return [];
};

/**
 * Remove stateful regex flags so repeated matcher.test() calls stay stable.
 *
 * @param {string} flags - Flags from a JavaScript regex literal.
 * @returns {string} Non-stateful regex flags.
 */
const normalizeRegexFlags = (flags) => flags.replace(/[gy]/g, '');

/**
 * Resolve a static require.context directory against the importing module.
 *
 * @param {string} id - Vite module id.
 * @param {string} request - Static directory request from require.context.
 * @returns {string} Absolute filesystem directory path.
 */
const resolveContextDirectory = (id, request) => {
  const importer = String(id || '').split('?')[0];
  if (!importer || importer.includes('/node_modules/')) return '';

  return resolve(dirname(importer), request);
};

/**
 * Find files in a context directory and return Webpack-style context keys.
 *
 * @param {string} directory - Absolute context directory.
 * @param {boolean} recursive - Whether nested directories are included.
 * @param {RegExp} matcher - Context file matcher.
 * @returns {string[]} Sorted `./file.ext` keys.
 */
function contextKeysFromDirectory(directory, recursive, matcher) {
  const keys = [];

  const visit = (currentDirectory) => {
    for (const entry of readdirSync(currentDirectory, {
      withFileTypes: true,
    })) {
      const absolutePath = resolve(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        if (recursive) visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const key = `./${toPosixPath(relative(directory, absolutePath))}`;
      if (matcher.test(key)) {
        keys.push(key);
      }
    }
  };

  visit(directory);
  return keys.sort();
}

/**
 * Resolve a public URL base for root project asset directories.
 *
 * @param {string} directory - Absolute context directory.
 * @returns {string} Public URL base, or an empty string when unknown.
 */
const publicBasePathForDirectory = (directory) => {
  const relativeDirectory = toPosixPath(relative(process.cwd(), directory));

  return relativeDirectory === 'assets' ||
    relativeDirectory.startsWith('assets/')
    ? `/${relativeDirectory.replace(/\/?$/, '/')}`
    : '';
};

/**
 * Build a key-only context for static assets to avoid module-importing files
 * that Storybook may also serve through staticDirs.
 *
 * @param {{ id?: string, request: string, recursive: boolean, regexSource: string, regexFlags: string, basePath: string }} options
 * Context details from the require.context call.
 * @returns {string|null} Replacement source, or null when the directory cannot be enumerated.
 */
function staticAssetContextReplacement({
  id,
  request,
  recursive,
  regexSource,
  regexFlags,
  basePath,
}) {
  const extensions = extensionsFromRegex(regexSource);
  if (
    !extensions.length ||
    !extensions.every((extension) => STATIC_ASSET_CONTEXT_EXTS.has(extension))
  ) {
    return null;
  }

  const directory = resolveContextDirectory(id, request);
  if (!directory || !existsSync(directory)) return null;

  const matcher = new RegExp(regexSource, normalizeRegexFlags(regexFlags));
  const keys = contextKeysFromDirectory(directory, recursive, matcher);
  const publicBasePath = publicBasePathForDirectory(directory);

  return (
    '__emulsifyRequireContextFromKeys(' +
    `${JSON.stringify(keys)}, ` +
    `${JSON.stringify(basePath)}, ` +
    `${JSON.stringify(publicBasePath)}` +
    ')'
  );
}

/**
 * Transform static require.context calls into Vite import.meta.glob calls.
 *
 * @param {string} source - JavaScript source.
 * @param {string} [id=''] - Vite module id.
 * @returns {string|null} Transformed source, or null when unchanged.
 */
export function transformRequireContext(source, id = '') {
  const replacements = [];
  let match;

  REQUIRE_CONTEXT_PATTERN.lastIndex = 0;
  while ((match = REQUIRE_CONTEXT_PATTERN.exec(source))) {
    const [, , request, recursive, regexSource, regexFlags] = match;
    const basePath = normalizeBasePath(request);
    const globTail = globTailFromRegex(regexSource);
    const globPattern = `${basePath}${recursive === 'true' ? '**/' : ''}${globTail}`;
    const matcherFlags = normalizeRegexFlags(regexFlags);
    const staticAssetReplacement = staticAssetContextReplacement({
      basePath,
      id,
      recursive: recursive === 'true',
      regexFlags,
      regexSource,
      request,
    });
    const replacement =
      staticAssetReplacement ||
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

      const code = transformRequireContext(source, id);
      return code ? { code, map: null } : null;
    },
  };
}
