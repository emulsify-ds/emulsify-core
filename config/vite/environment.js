/**
 * @file Environment resolution for Emulsify + Vite.
 *
 * Reads project settings and exposes a normalized “env” object used by
 * entries, plugins, and the Vite config.
 *
 * Highlights:
 *  - `platform`: from env var or project.emulsify.json (default "generic").
 *  - `SDC`: boolean from project.emulsify.json `project.singleDirectoryComponents`.
 *  - `structureOverrides`: true when `variant.structureImplementations` exists and is non-empty.
 *  - `structureRoots`: array of directories from `variant.structureImplementations`.
 */

import fs from 'fs';
import { resolve, normalize, sep } from 'path';

/**
 * Ensure an absolute path stays inside the project directory.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string} candidate - Path to validate (absolute or relative).
 * @returns {string|null} A safe absolute path, or null if outside projectDir.
 */
function coerceToProjectPath(projectDir, candidate) {
  const absProject = resolve(projectDir);
  const absCandidate = resolve(projectDir, candidate);
  // Guard: ensure the resulting path is inside the project.
  const projWithSep = absProject.endsWith(sep) ? absProject : absProject + sep;
  if (absCandidate === absProject || absCandidate.startsWith(projWithSep)) {
    return absCandidate;
  }
  return null;
}

/**
 * Resolve environment for the current project.
 *
 * @returns {{
 *   projectDir: string,
 *   srcDir: string,
 *   srcExists: boolean,
 *   platform: 'drupal'|'generic'|string,
 *   SDC: boolean,
 *   structureOverrides: boolean,
 *   structureRoots: string[]
 * }}
 */
export function resolveEnvironment() {
  const projectDir = process.cwd();

  // Prefer <project>/src if it exists; otherwise fall back to <project>/components.
  const srcPath = resolve(projectDir, 'src');
  const srcExists = fs.existsSync(srcPath);
  const srcDir = srcExists ? srcPath : resolve(projectDir, 'components');

  // Platform (1) env var, (2) project.emulsify.json, (3) default 'generic'.
  let platform = (process.env.EMULSIFY_PLATFORM || '')
    .toString()
    .toLowerCase()
    .trim();

  let SDC = false;
  /** @type {string[]} */
  let structureRoots = [];

  try {
    const cfgPath = resolve(projectDir, 'project.emulsify.json');
    if (fs.existsSync(cfgPath)) {
      const raw = fs.readFileSync(cfgPath, 'utf8');
      const json = JSON.parse(raw);

      if (!platform) {
        platform = (json?.project?.platform || json?.platform || '')
          .toString()
          .toLowerCase()
          .trim();
      }

      // Single Directory Components (SDC) boolean.
      SDC = Boolean(json?.project?.singleDirectoryComponents);

      // Component Structure Overrides:
      // older projects may define custom component roots via variant.structureImplementations.
      const maybeRoots =
        json?.variant?.structureImplementations ??
        json?.project?.variant?.structureImplementations ??
        [];

      structureRoots = Array.isArray(maybeRoots)
        ? maybeRoots
            .filter(Boolean)
            .map((dir) => {
              const coerced = coerceToProjectPath(projectDir, dir);
              return coerced ? normalize(coerced) : null;
            })
            .filter(Boolean)
        : [];
    }
  } catch {
    // Ignore parse errors; fall back to defaults.
  }

  if (!platform) platform = 'generic';

  const structureOverrides = structureRoots.length > 0;

  return {
    projectDir,
    srcDir,
    srcExists,
    platform,
    SDC,
    structureOverrides,
    structureRoots,
  };
}
