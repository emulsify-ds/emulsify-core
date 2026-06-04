/**
 * @file YAML module plugin for Vite imports.
 *
 * This plugin turns YAML imports into ESM modules with default exports and safe
 * named exports for valid top-level keys.
 */

import { load as loadYaml } from 'js-yaml';

/**
 * Remove the Vite query string from a module id.
 *
 * @param {string} id - Vite module id.
 * @returns {string} Filesystem path without query parameters.
 */
const stripRequestQuery = (id) => id.split('?')[0];

/**
 * Determine whether a Vite request should compile as a YAML module.
 *
 * @param {string} id - Vite module id, including an optional query string.
 * @returns {boolean} TRUE when the request is a YAML data import.
 */
const isYamlModuleRequest = (id) => {
  const [filePath, query = ''] = id.split('?');
  if (!/\.ya?ml$/i.test(filePath)) return false;
  return !/(^|&)(raw|url)\b/.test(query);
};

const reservedYamlExportIdentifiers = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

/**
 * Determine whether a YAML key can be emitted as a named ESM export.
 *
 * @param {string} key - Top-level YAML object key.
 * @returns {boolean} TRUE when the key is safe to emit as a named export.
 */
const isValidYamlExportIdentifier = (key) =>
  /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(key) &&
  !key.startsWith('$') &&
  !reservedYamlExportIdentifiers.has(key);

/**
 * Determine whether a parsed YAML value is a plain object.
 *
 * @param {*} value - Parsed YAML value.
 * @returns {boolean} TRUE when the value is a plain object.
 */
const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

/**
 * Transform YAML imports into JavaScript modules.
 *
 * @returns {import('vite').PluginOption} YAML module plugin.
 */
export function yamlModulePlugin() {
  return {
    name: 'emulsify-yaml',
    enforce: 'pre',
    transform(source, id) {
      if (!isYamlModuleRequest(id)) {
        return null;
      }

      try {
        const data = loadYaml(source) ?? null;
        const namedExports = isPlainObject(data)
          ? Object.entries(data)
              .filter(([key]) => isValidYamlExportIdentifier(key))
              .map(
                ([key, value]) =>
                  `export const ${key} = ${JSON.stringify(value)};`,
              )
              .join('\n')
          : '';
        const defaultExport = `export default ${JSON.stringify(data)};`;

        return {
          code: `${namedExports}${namedExports ? '\n' : ''}${defaultExport}\n`,
          map: null,
        };
      } catch (error) {
        this.error(
          `Unable to parse YAML module ${stripRequestQuery(id)}: ${
            error?.message || error
          }`,
        );
      }

      return null;
    },
  };
}
