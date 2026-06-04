/**
 * @file Normalized project configuration for Emulsify Vite and Storybook.
 *
 * This module is the single Node-side reader for `project.emulsify.json`.
 * Validation is intentionally permissive so existing projects can upgrade
 * without reshaping older config files. Resolved config objects are memoized
 * per project directory and relevant environment signature for one process.
 */

import { normalize, resolve, sep } from 'path';
import { getPlatformAdapter } from './platforms.js';
import { resolveProjectStructure } from './project-structure.js';
import { safeExists, safeReadJson } from './utils/fs-safe.js';

/**
 * Cache normalized project config by project root and relevant env signature.
 *
 * @type {Map<string, Map<string, object>>}
 */
const projectConfigCache = new Map();

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
 * Normalize config strings to lowercase identifiers.
 *
 * @param {*} value - Candidate value.
 * @returns {string} Normalized string.
 */
function normalizeIdentifier(value) {
  return (value || '').toString().toLowerCase().trim();
}

/**
 * Build the environment signature for config values that affect resolution.
 *
 * @param {NodeJS.ProcessEnv|Record<string,string>} env - Environment values.
 * @returns {string} Stable cache-key segment.
 */
function projectConfigEnvSignature(env = {}) {
  return JSON.stringify({
    EMULSIFY_PLATFORM: normalizeIdentifier(env.EMULSIFY_PLATFORM),
  });
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
  const envSignature = projectConfigEnvSignature(env);
  const cachedByEnv = projectConfigCache.get(root);
  if (cachedByEnv?.has(envSignature)) {
    return cachedByEnv.get(envSignature);
  }

  const configPath = coerceToProjectPath(root, 'project.emulsify.json');
  const rawConfigResult = configPath ? safeReadJson(configPath) : {};
  const rawConfig =
    rawConfigResult?.data && typeof rawConfigResult.data === 'object'
      ? rawConfigResult.data
      : {};

  const srcCandidate = resolve(root, 'src');
  const srcExists = safeExists(srcCandidate);
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

  const config = {
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

  const rootCache = cachedByEnv || new Map();
  rootCache.set(envSignature, config);
  projectConfigCache.set(root, rootCache);

  return config;
}

/**
 * Clear the process-local project config memoization cache.
 *
 * Tests call this to avoid cross-test pollution when they mutate fixture
 * projects in the same Node process.
 *
 * @returns {void}
 */
export function resetProjectConfigCache() {
  projectConfigCache.clear();
}
