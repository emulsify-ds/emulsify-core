/**
 * @file Project-level Vite extension loader.
 *
 * Loads optional project-level Vite plugin extensions from:
 *   config/emulsify-core/vite/plugins.(mjs|js|cjs)
 *
 * Supported shapes in that file:
 *   1) export default [vitePlugin(), ...]
 *   2) export default (ctx) => [vitePlugin(), ...]
 *   3) module.exports = [ ... ]
 *   4) export const extendConfig = (config, ctx) => patchObject
 */

import { isAbsolute, normalize, relative, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import { firstExistingPath } from './utils/fs-safe.js';

const extensionCandidates = [
  'config/emulsify-core/vite/plugins.mjs',
  'config/emulsify-core/vite/plugins.js',
  'config/emulsify-core/vite/plugins.cjs',
];

/**
 * Normalize CommonJS module results into an ESM-like shape.
 *
 * @param {*} mod - Required module result.
 * @returns {object} Module namespace-like object.
 */
function cjsModule(mod) {
  return mod && typeof mod === 'object' ? mod : { default: mod };
}

/**
 * Determine whether a failed CommonJS load should retry as native ESM.
 *
 * @param {Error} error - CommonJS load error.
 * @returns {boolean} TRUE when native import should handle the module.
 */
function shouldImportAsEsm(error) {
  return (
    ['ERR_REQUIRE_ESM', 'ERR_REQUIRE_ASYNC_MODULE'].includes(error?.code) ||
    /Cannot use import statement outside a module|Unexpected token 'export'|Unexpected token export/.test(
      error?.message || '',
    )
  );
}

/**
 * Resolve the consuming project root for project-level extensions.
 *
 * @param {object} ctx - Context passed to project plugin factories.
 * @returns {string} Absolute path.
 */
function projectRoot(ctx = {}) {
  return resolve(ctx?.env?.projectDir || process.cwd());
}

/**
 * Resolve a path inside the consuming project root.
 *
 * @param {string} root - Absolute project root.
 * @param {string} rel - Project-relative path.
 * @returns {string} Absolute path.
 */
function inProject(root, rel) {
  return resolve(root, rel);
}

/**
 * Determine whether an absolute path stays inside the consuming project root.
 *
 * @param {string} root - Absolute project root.
 * @param {string} abs - Absolute path to inspect.
 * @returns {boolean} TRUE when the path is under the project root.
 */
function insideProject(root, abs) {
  const target = normalize(abs);
  const rel = relative(root, target);
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Load an ESM or CJS module from an absolute path.
 *
 * @param {string|null} absPath - Absolute module path.
 * @returns {Promise<object|null>} Module namespace or null.
 */
async function loadModule(absPath) {
  if (!absPath) return null;
  const req = createRequire(absPath);

  if (absPath.endsWith('.cjs')) {
    return cjsModule(req(absPath));
  }

  if (absPath.endsWith('.js')) {
    try {
      return cjsModule(req(absPath));
    } catch (error) {
      if (!shouldImportAsEsm(error)) {
        throw error;
      }
    }
  }

  return import(pathToFileURL(absPath).href);
}

/**
 * Normalize CJS and ESM default export shapes.
 *
 * @param {object|null} mod - Loaded module namespace.
 * @returns {*} Supported default export shape.
 */
function defaultExport(mod) {
  const raw = mod?.default ?? mod;
  if (
    raw &&
    typeof raw === 'object' &&
    (Array.isArray(raw.default) || typeof raw.default === 'function')
  ) {
    return raw.default;
  }
  return raw;
}

/**
 * Normalize named ESM and CJS object exports for extendConfig.
 *
 * @param {object|null} mod - Loaded module namespace.
 * @returns {Function|undefined} Project config patcher, when present.
 */
function extendConfigExport(mod) {
  if (typeof mod?.extendConfig === 'function') {
    return mod.extendConfig;
  }
  if (typeof mod?.default?.extendConfig === 'function') {
    return mod.default.extendConfig;
  }
  return undefined;
}

/**
 * Load user-supplied plugins and an optional config patcher.
 *
 * @param {object} ctx - Context passed to project plugin factories.
 * @returns {Promise<{ projectPlugins: import('vite').PluginOption[], extendConfig?: Function }>}
 */
export async function loadProjectExtensions(ctx = {}) {
  const root = projectRoot(ctx);
  const candidate =
    firstExistingPath(
      extensionCandidates
        .map((candidatePath) => inProject(root, candidatePath))
        .filter((candidatePath) => insideProject(root, candidatePath)),
    ) || null;

  if (!candidate) return { projectPlugins: [] };

  const mod = await loadModule(candidate);

  // Normalize supported default export shapes into a plugin array.
  let projectPlugins = [];
  const raw = defaultExport(mod);
  if (Array.isArray(raw)) {
    projectPlugins = raw;
  } else if (typeof raw === 'function') {
    projectPlugins = raw(ctx) || [];
  }

  // Named extendConfig export lets projects patch the assembled Vite config.
  const extendConfig = extendConfigExport(mod);

  return { projectPlugins, extendConfig };
}
