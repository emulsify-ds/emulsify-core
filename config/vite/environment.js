/**
 * @file Environment resolution for Emulsify + Vite.
 * @description
 * Reads project-local config and returns normalized env flags used by the
 * entries and plugin layers.
 *
 * - projectDir: absolute CWD
 * - srcDir/srcExists: prefer <project>/src if present, else <project>/components
 * - platform: 'drupal' | 'generic' (env var wins, else project.emulsify.json)
 * - SDC: boolean (single directory components)
 *        Read from env var EMULSIFY_SDC (if set) else project.emulsify.json
 */

import fs from 'fs';
import { resolve } from 'path';

/**
 * @typedef {Object} EmulsifyEnv
 * @property {string} projectDir
 * @property {string} srcDir
 * @property {boolean} srcExists
 * @property {string} platform
 * @property {boolean} SDC
 */

/**
 * Resolve environment details for the current project.
 * @returns {EmulsifyEnv}
 */
export function resolveEnvironment() {
  const projectDir = process.cwd();

  // Prefer <proj>/src; fall back to <proj>/components
  const srcPath = resolve(projectDir, 'src');
  const srcExists = fs.existsSync(srcPath);
  const srcDir = srcExists ? srcPath : resolve(projectDir, 'components');

  // Defaults
  let platform = 'generic';
  let SDC = false;

  // Optional: project.emulsify.json
  try {
    const cfgPath = resolve(projectDir, 'project.emulsify.json');
    if (fs.existsSync(cfgPath)) {
      const raw = fs.readFileSync(cfgPath, 'utf8');
      const json = JSON.parse(raw);

      const p = (json?.project?.platform || json?.platform || '')
        .toString()
        .trim()
        .toLowerCase();
      if (p) platform = p;

      // SDC from config (boolean if present)
      if (typeof json?.project?.singleDirectoryComponents === 'boolean') {
        SDC = Boolean(json.project.singleDirectoryComponents);
      }
    }
  } catch {
    // ignore read/parse errors and keep defaults
  }

  // Environment variable overrides (highest precedence)
  const envPlatform = (process.env.EMULSIFY_PLATFORM || '')
    .toString()
    .trim()
    .toLowerCase();
  if (envPlatform) platform = envPlatform;

  if (typeof process.env.EMULSIFY_SDC !== 'undefined') {
    const v = (process.env.EMULSIFY_SDC || '').toString().trim().toLowerCase();
    // Accept "1", "true", "yes" → true
    SDC = v === '1' || v === 'true' || v === 'yes';
  }

  return { projectDir, srcDir, srcExists, platform, SDC };
}
