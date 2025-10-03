/**
 * @file Environment resolution for Emulsify + Vite.
 *
 * Reads project settings and exposes a normalized “env” object used by
 * entries, plugins, and the Vite config.
 *
 * Highlights:
 *  - `platform`: from env var or project.emulsify.json (default "generic").
 *  - `SDC`: boolean from project.emulsify.json `project.singleDirectoryComponents`.
 *  - `legacyVariant`: true when `variant.structureImplementations` exists and is non-empty.
 *  - `variantRoots`: array of directories from `variant.structureImplementations`.
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
  const inProject =
    absCandidate.startsWith(absProject + sep) || absCandidate === absProject;
  return inProject ? absCandidate : null;
}

/**
 * Safe existence check (guards path is inside project root).
 *
 * NOTE: Using this wrapper avoids sprinkling fs.* calls over non-literal paths.
 *       If eslint still flags it, it’s one narrow, justified place to disable.
 *
 * @param {string} absPath
 * @param {string} projectDir
 */
function safeExistsSync(absPath, projectDir) {
  const safe = coerceToProjectPath(projectDir, absPath);
  if (!safe) return false;
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.existsSync(safe);
}

/**
 * Safe JSON reader (only for known, in-repo files).
 *
 * @param {string} projectDir
 * @param {string} relFilename
 * @returns {any|null}
 */
function safeReadJson(projectDir, relFilename) {
  const safe = coerceToProjectPath(projectDir, relFilename);
  if (!safe) return null;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(safe)) return null;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const raw = fs.readFileSync(safe, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve environment details for the current project.
 *
 * @returns {{
 *   projectDir: string,
 *   srcDir: string,
 *   srcExists: boolean,
 *   platform: 'drupal' | 'generic' | string,
 *   SDC: boolean,
 *   legacyVariant: boolean,
 *   variantRoots: string[]
 * }}
 */
export function resolveEnvironment() {
  const projectDir = process.cwd();

  // Prefer <project>/src when present; else <project>/components (legacy repos).
  const srcCandidate = resolve(projectDir, 'src');
  const srcExists = safeExistsSync(srcCandidate, projectDir);
  const srcDir = srcExists ? srcCandidate : resolve(projectDir, 'components');

  // Platform: ENV wins, then JSON, else default.
  let platform = (process.env.EMULSIFY_PLATFORM || '')
    .toString()
    .toLowerCase()
    .trim();
  const emulsifyJson = safeReadJson(projectDir, 'project.emulsify.json');

  if (!platform) {
    platform = (
      emulsifyJson?.project?.platform ||
      emulsifyJson?.variant?.platform ||
      'generic'
    )
      .toString()
      .toLowerCase()
      .trim();
  }

  // Single Directory Components flag (if present).
  const SDC = Boolean(emulsifyJson?.project?.singleDirectoryComponents);

  // Legacy variant support (structureImplementations).
  const variantRoots = Array.isArray(
    emulsifyJson?.variant?.structureImplementations,
  )
    ? emulsifyJson.variant.structureImplementations
        .map((item) =>
          typeof item?.directory === 'string' ? item.directory : null,
        )
        .filter(Boolean)
        .map((dir) => {
          const coerced = coerceToProjectPath(projectDir, dir);
          return coerced ? normalize(coerced) : null;
        })
        .filter(Boolean)
    : [];

  const legacyVariant = variantRoots.length > 0;

  return {
    projectDir,
    srcDir,
    srcExists,
    platform,
    SDC,
    legacyVariant,
    variantRoots,
  };
}
