/**
 * @file Environment resolution for Emulsify + Vite.
 *
 * @summary
 * Discovers the project environment in a safe, explicit way:
 *  - `projectDir`: absolute CWD
 *  - `srcDir`: prefers `<project>/src` when it exists, else `<project>/components`
 *  - `srcExists`: whether `<project>/src` is present
 *  - `platform`: lowercased platform, e.g. "drupal" (from ENV or project.emulsify.json)
 *  - `isDrupal`: derived boolean (platform === "drupal")
 *  - `SDC`: Single Directory Components mode (boolean), from `project.singleDirectoryComponents`
 *
 * Implementation notes:
 *  - File system reads are **strictly constrained** to files within `projectDir`.
 *  - We use small helpers to validate/normalize paths before calling `fs` APIs.
 *  - To keep ESLint security rules happy, any remaining dynamic fs calls are
 *    guarded and have narrow, justified `eslint-disable-next-line` comments.
 */

import fs from 'fs';
import path from 'path';

/* ============================================================================
 * Internal helpers (path safety + JSON reading)
 * ========================================================================== */

/**
 * Convert a path to its absolute, normalized form.
 * @param {string} base - Base directory.
 * @param {string} relative - Relative (or absolute) path to resolve.
 * @returns {string} Absolute, normalized path.
 */
function resolveInside(base, relative) {
  const abs = path.resolve(base, relative);
  // Normalize to handle mixed separators consistently.
  return path.normalize(abs);
}

/**
 * Check that `candidate` is a descendant of (or equal to) `root`.
 * @param {string} root - Absolute, normalized root path.
 * @param {string} candidate - Absolute, normalized candidate path.
 * @returns {boolean}
 */
function isSubpath(root, candidate) {
  const rootNorm = path.normalize(root + path.sep);
  const candNorm = path.normalize(candidate + path.sep);
  return candNorm.startsWith(rootNorm);
}

/**
 * Safely check for a file/directory inside the project root.
 * Constrains the path to `<projectDir>/<relative>`.
 *
 * @param {string} projectDir - Absolute project directory.
 * @param {string} relative - Relative path inside the project.
 * @returns {boolean}
 */
function safeExists(projectDir, relative) {
  const target = resolveInside(projectDir, relative);
  if (!isSubpath(projectDir, target)) return false;
  // Dynamic path is validated (descendant of projectDir), suppress rule for this line.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.existsSync(target);
}

/**
 * Safely read and parse JSON from a whitelisted file inside the project root.
 *
 * @param {string} projectDir - Absolute project directory.
 * @param {string} relative - Relative JSON path (only "project.emulsify.json" is allowed).
 * @returns {unknown|null} Parsed JSON object or null on error/missing.
 */
function safeReadJson(projectDir, relative) {
  // Whitelist only the expected config file name.
  if (relative !== 'project.emulsify.json') return null;

  const target = resolveInside(projectDir, relative);
  if (!isSubpath(projectDir, target)) return null;

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const raw = fs.readFileSync(target, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ============================================================================
 * Public API
 * ========================================================================== */

/**
 * Resolve environment details for the current project.
 *
 * Resolution order:
 *  - `projectDir`: process.cwd()
 *  - `srcDir`: `<projectDir>/src` if present, else `<projectDir>/components`
 *  - `platform`:
 *      1) `process.env.EMULSIFY_PLATFORM` (string)
 *      2) `project.emulsify.json` → `project.platform` or `platform`
 *      3) fallback "generic"
 *  - `SDC`:
 *      1) `process.env.EMULSIFY_SDC` ("1","true" → true; "0","false" → false)
 *      2) `project.emulsify.json` → `project.singleDirectoryComponents` (boolean)
 *      3) fallback false
 *
 * @returns {{
 *   projectDir: string,
 *   srcDir: string,
 *   srcExists: boolean,
 *   platform: string,
 *   isDrupal: boolean,
 *   SDC: boolean
 * }}
 */
export function resolveEnvironment() {
  // 1) Project root
  const projectDir = process.cwd();

  // 2) Source directory preference: `src/` → `components/`
  const srcPreferred = 'src';
  const srcFallback = 'components';

  const hasSrc = safeExists(projectDir, srcPreferred);
  const srcDir = hasSrc
    ? resolveInside(projectDir, srcPreferred)
    : resolveInside(projectDir, srcFallback);

  // 3) Load project config if present (safely)
  const config = safeReadJson(projectDir, 'project.emulsify.json');
  const projectSection =
    config && typeof config === 'object'
      ? /** @type {{ project?: { platform?: string, singleDirectoryComponents?: boolean }, platform?: string }} */ (
          config
        ).project
        ? /** @type {{ platform?: string, singleDirectoryComponents?: boolean }} */ (
            /** @type {{ project?: unknown }} */ (config).project
          )
        : undefined
      : undefined;

  // 4) Platform (env → config → default)
  const envPlatform = (process.env.EMULSIFY_PLATFORM || '')
    .toString()
    .trim()
    .toLowerCase();
  const cfgPlatform = (
    projectSection?.platform ||
    (config &&
      typeof config === 'object' &&
      /** @type {{ platform?: string }} */ (config).platform) ||
    ''
  )
    .toString()
    .trim()
    .toLowerCase();

  const platform = envPlatform || cfgPlatform || 'generic';
  const isDrupal = platform === 'drupal';

  // 5) SDC (env → config → default)
  const envSDC = (process.env.EMULSIFY_SDC || '')
    .toString()
    .trim()
    .toLowerCase();
  const envSDCBool =
    envSDC === '1' || envSDC === 'true'
      ? true
      : envSDC === '0' || envSDC === 'false'
        ? false
        : undefined;

  const cfgSDC =
    typeof projectSection?.singleDirectoryComponents === 'boolean'
      ? projectSection.singleDirectoryComponents
      : false;

  const SDC = typeof envSDCBool === 'boolean' ? envSDCBool : cfgSDC;

  return {
    projectDir,
    srcDir,
    srcExists: hasSrc,
    platform,
    isDrupal,
    SDC,
  };
}
