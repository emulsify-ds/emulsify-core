/**
 * @file Project-level Vite extension loader.
 *
 * Loads optional project-level Vite plugin extensions from:
 *   .config/emulsify-core/vite/plugins.(mjs|js|cjs)
 *
 * Supported shapes in that file:
 *   1) export default [vitePlugin(), ...]
 *   2) export default (ctx) => [vitePlugin(), ...]
 *   3) module.exports = [ ... ]
 *   4) export const extendConfig = (config, ctx) => patchObject
 */

import { resolve, normalize } from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import { firstExistingPath } from './utils/fs-safe.js';

/**
 * Resolve a path inside the current project root.
 *
 * @param {string} rel - Project-relative path.
 * @returns {string} Absolute path.
 */
function inProject(rel) {
  return resolve(process.cwd(), rel);
}

/**
 * Determine whether an absolute path stays inside the current project.
 *
 * @param {string} abs - Absolute path to inspect.
 * @returns {boolean} TRUE when the path is under the current working directory.
 */
function insideCwd(abs) {
  const base = normalize(process.cwd() + '/');
  const target = normalize(abs);
  return target.startsWith(base);
}

/**
 * Load an ESM or CJS module from an absolute path.
 *
 * @param {string|null} absPath - Absolute module path.
 * @returns {Promise<object|null>} Module namespace or null.
 */
async function loadModule(absPath) {
  if (!absPath) return null;
  if (absPath.endsWith('.cjs')) {
    const req = createRequire(import.meta.url);

    const mod = req(absPath);
    return mod && typeof mod === 'object' ? mod : { default: mod };
  }
  // Treat .mjs and .js files as ESM in this package.
  return import(pathToFileURL(absPath).href);
}

/**
 * Load user-supplied plugins and an optional config patcher.
 *
 * @param {object} ctx - Context passed to project plugin factories.
 * @returns {Promise<{ projectPlugins: import('vite').PluginOption[], extendConfig?: Function }>}
 */
export async function loadProjectExtensions(ctx = {}) {
  const candidate =
    firstExistingPath(
      [
        '.config/emulsify-core/vite/plugins.mjs',
        '.config/emulsify-core/vite/plugins.js',
        '.config/emulsify-core/vite/plugins.cjs',
      ]
        .map(inProject)
        .filter(insideCwd),
    ) || null;

  if (!candidate) return { projectPlugins: [] };

  const mod = await loadModule(candidate);

  // Normalize supported default export shapes into a plugin array.
  let projectPlugins = [];
  const raw = mod?.default ?? mod;
  if (Array.isArray(raw)) {
    projectPlugins = raw;
  } else if (typeof raw === 'function') {
    projectPlugins = raw(ctx) || [];
  }

  // Named extendConfig export lets projects patch the assembled Vite config.
  const extendConfig =
    typeof mod?.extendConfig === 'function' ? mod.extendConfig : undefined;

  return { projectPlugins, extendConfig };
}
