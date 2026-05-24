/**
 * @file Normalized project configuration for Emulsify Vite and Storybook.
 *
 * This module is the single Node-side reader for `project.emulsify.json`.
 * Validation is intentionally permissive so existing projects can upgrade
 * without reshaping older config files.
 */

import fs from 'fs';
import { normalize, resolve, sep } from 'path';
import { getPlatformAdapter } from './platforms.js';
import { resolveProjectStructure } from './project-structure.js';

/**
 * Ensure an absolute path stays inside the project directory.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string} candidate - Path to validate (absolute or relative).
 * @returns {string|null} A safe absolute path, or null if outside projectDir.
 */
export function coerceToProjectPath(projectDir, candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;

  const absProject = resolve(projectDir);
  const absCandidate = resolve(projectDir, candidate);
  const inProject =
    absCandidate.startsWith(absProject + sep) || absCandidate === absProject;
  return inProject ? absCandidate : null;
}

/**
 * Safe JSON reader for known in-project files.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string} relFilename - Project-relative JSON filename.
 * @returns {object} Parsed object or empty object when absent/invalid.
 */
function safeReadJson(projectDir, relFilename) {
  const safe = coerceToProjectPath(projectDir, relFilename);
  if (!safe) return {};
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(safe)) return {};
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const raw = fs.readFileSync(safe, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Normalize config strings to lowercase identifiers.
 *
 * @param {*} value - Candidate value.
 * @returns {string} Normalized string.
 */
function normalizeIdentifier(value) {
  return (value || '').toString().toLowerCase().trim();
}

/**
 * Normalize variant structure implementation declarations.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {Array} implementations - Raw implementation entries.
 * @returns {{name: string, directory: string}[]} Safe implementation entries.
 */
function normalizeStructureImplementations(projectDir, implementations = []) {
  if (!Array.isArray(implementations)) return [];

  return implementations
    .map((item, index) => {
      const rawDirectory =
        typeof item?.directory === 'string' ? item.directory : null;
      const directory = rawDirectory
        ? coerceToProjectPath(projectDir, rawDirectory)
        : null;
      if (!directory) return null;

      const name =
        typeof item?.name === 'string' && item.name.trim()
          ? normalizeIdentifier(item.name)
          : `structure-${index + 1}`;

      return {
        name,
        directory: normalize(directory),
      };
    })
    .filter(Boolean);
}

/**
 * Normalize project config for current tooling consumers.
 *
 * @param {string} [projectDir=process.cwd()] - Absolute project root.
 * @param {NodeJS.ProcessEnv|Record<string,string>} [env=process.env] - Environment values.
 * @returns {object} Normalized Emulsify environment/config model.
 */
export function resolveProjectConfig(
  projectDir = process.cwd(),
  env = process.env,
) {
  const root = resolve(projectDir);
  const rawConfig = safeReadJson(root, 'project.emulsify.json');

  const srcCandidate = resolve(root, 'src');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const srcExists = fs.existsSync(srcCandidate);
  const srcDir = srcExists ? srcCandidate : resolve(root, 'components');

  const platform =
    normalizeIdentifier(env.EMULSIFY_PLATFORM) ||
    normalizeIdentifier(rawConfig?.project?.platform) ||
    normalizeIdentifier(rawConfig?.variant?.platform) ||
    'generic';
  const platformAdapter = getPlatformAdapter(platform);

  const singleDirectoryComponents = Boolean(
    rawConfig?.project?.singleDirectoryComponents,
  );
  const rawStructureImplementations =
    rawConfig?.variant?.structureImplementations;
  const structureImplementations = normalizeStructureImplementations(
    root,
    rawStructureImplementations,
  );
  const structureRoots = structureImplementations.map(
    (implementation) => implementation.directory,
  );
  const projectStructure = resolveProjectStructure({
    projectDir: root,
    srcDir,
    srcExists,
    SDC: singleDirectoryComponents,
    structureImplementations,
    platformAdapter,
  });

  return {
    projectDir: root,
    platform,
    machineName:
      typeof rawConfig?.project?.machineName === 'string'
        ? rawConfig.project.machineName
        : undefined,
    srcExists,
    srcDir,
    singleDirectoryComponents,
    SDC: singleDirectoryComponents,
    structureOverrides: projectStructure.structureOverrides,
    structureImplementations,
    structureRoots,
    componentRoots: projectStructure.componentRoots,
    globalRoots: projectStructure.globalRoots,
    namespaceRoots: projectStructure.namespaceRoots,
    outputStrategy: platformAdapter.outputStrategy,
    outputMode: platformAdapter.outputStrategy,
    projectStructure,
    platformAdapter,
    adapter: platformAdapter,
    projectConfig: rawConfig,
  };
}
