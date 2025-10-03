/**
 * @file user-vite-extensions.js
 * @description
 * Loads optional project-level Vite plugin extensions from:
 *   .config/emulsify-core/vite/plugins.(mjs|js|cjs)
 *
 * Supported shapes in that file:
 *   1) export default [vitePlugin(), ...]
 *   2) export default (ctx) => [vitePlugin(), ...]
 *   3) module.exports = [ ... ]  // CJS
 *   4) export const extendConfig = (config, ctx) => patchObject
 *      // lets the project tweak the final Vite config (e.g. set postcss)
 */

import { existsSync } from 'fs';
import { resolve, normalize } from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

/** Resolve absolute path inside project root */
function inProject(rel) {
  return resolve(process.cwd(), rel);
}

/** Guard: ensure path stays under project root (helps strict linters) */
function insideCwd(abs) {
  const base = normalize(process.cwd() + '/');
  const target = normalize(abs);
  return target.startsWith(base);
}

/** Try file candidates in order, return the first that exists */
function firstExisting(paths) {
  for (const rel of paths) {
    const abs = inProject(rel);
    if (!insideCwd(abs)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (existsSync(abs)) return abs;
  }
  return null;
}

/** Load ESM or CJS module by path (returns its module namespace) */
async function loadModule(absPath) {
  if (!absPath) return null;
  if (absPath.endsWith('.cjs')) {
    const req = createRequire(import.meta.url);

    const mod = req(absPath);
    return mod && typeof mod === 'object' ? mod : { default: mod };
  }
  // ESM (.mjs or .js treated as ESM here)
  return import(pathToFileURL(absPath).href);
}

/**
 * Load user-supplied plugins & optional config patcher.
 * @param {object} ctx - anything useful you want to pass (env, helpers)
 * @returns {Promise<{ projectPlugins: import('vite').PluginOption[], extendConfig?: Function }>}
 */
export async function loadProjectExtensions(ctx = {}) {
  const candidate = firstExisting([
    '.config/emulsify-core/vite/plugins.mjs',
    '.config/emulsify-core/vite/plugins.js',
    '.config/emulsify-core/vite/plugins.cjs',
  ]);

  if (!candidate) return { projectPlugins: [] };

  const mod = await loadModule(candidate);

  // Gather plugins (array or function)
  let projectPlugins = [];
  const raw = mod?.default ?? mod;
  if (Array.isArray(raw)) {
    projectPlugins = raw;
  } else if (typeof raw === 'function') {
    projectPlugins = raw(ctx) || [];
  }

  // Optional named export for patching Vite config
  const extendConfig =
    typeof mod?.extendConfig === 'function' ? mod.extendConfig : undefined;

  return { projectPlugins, extendConfig };
}
