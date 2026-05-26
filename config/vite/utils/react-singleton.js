/**
 * @file React singleton helpers for Storybook and Vite config.
 */

import { unique } from './unique.js';

/**
 * React modules that must resolve from the consumer project root.
 *
 * @type {string[]}
 */
export const reactSingletonModules = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
];

const asArray = (value) => (Array.isArray(value) ? value : []);

const isObjectAlias = (alias) =>
  alias && typeof alias === 'object' && !Array.isArray(alias);

/**
 * Merge Vite alias config when all aliases use object syntax.
 *
 * Array-style aliases are already order-sensitive Vite config, so this helper
 * leaves mixed/array alias forms to Vite's normal merge behavior.
 *
 * @param {...import('vite').UserConfig} configs - Vite config objects.
 * @returns {object|undefined} Merged alias object when applicable.
 */
function mergeObjectAliases(...configs) {
  const aliases = configs
    .map((config) => config?.resolve?.alias)
    .filter(Boolean);

  if (!aliases.length || aliases.some((alias) => !isObjectAlias(alias))) {
    return undefined;
  }

  return Object.assign({}, ...aliases);
}

/**
 * Merge Vite resolve config while forcing React to a single project instance.
 *
 * Later configs override earlier shallow resolve properties, while all dedupe
 * lists are preserved and extended with React's runtime modules.
 *
 * @param {...import('vite').UserConfig} configs - Vite config objects.
 * @returns {import('vite').UserConfig['resolve']} Merged resolve config.
 */
export function mergeReactSingletonResolve(...configs) {
  const alias = mergeObjectAliases(...configs);
  const mergedResolve = configs.reduce(
    (merged, config) => ({
      ...merged,
      ...(config?.resolve || {}),
    }),
    {},
  );

  return {
    ...mergedResolve,
    ...(alias ? { alias } : {}),
    dedupe: unique([
      ...configs.flatMap((config) => asArray(config?.resolve?.dedupe)),
      ...reactSingletonModules,
    ]),
  };
}

/**
 * Merge optimizeDeps include lists and include React singleton modules.
 *
 * @param {...string[]} includeLists - Existing optimizeDeps include arrays.
 * @returns {string[]} Merged include list.
 */
export function mergeReactSingletonOptimizeDeps(...includeLists) {
  return unique([
    ...includeLists.flatMap((includeList) => asArray(includeList)),
    ...reactSingletonModules,
  ]);
}
