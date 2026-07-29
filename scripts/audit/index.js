/**
 * @file Audit orchestration and check registry.
 */

import { resolve } from 'node:path';
import { resolveProjectConfig } from '../../config/vite/project-config.js';
import { safeExists } from '../../config/vite/utils/fs-safe.js';
import { auditCoreImports } from './checks/core-imports.js';
import { auditCssAssetReferences } from './checks/css-asset-references.js';
import { auditDrupalAssumptions } from './checks/drupal-assumptions.js';
import { auditFilesOutsideRoots } from './checks/files-outside-roots.js';
import { auditGeneratedPackageScripts } from './checks/generated-package-scripts.js';
import { auditLegacyTwigStories } from './checks/legacy-twig-stories.js';
import { auditPackageOverrides } from './checks/package-overrides.js';
import { auditProjectConfig } from './checks/project-config.js';
import { auditStoryDiscovery } from './checks/story-discovery.js';
import { auditTwigReferences } from './checks/twig-references.js';
import { auditTwigVolume } from './checks/twig-volume.js';
import { auditWebpackPatterns } from './checks/webpack-patterns.js';
import {
  collectRootedProjectFiles,
  normalizeAuditRoots,
  resetFileReadCache,
} from './lib/files.js';

const STORY_GLOB = '**/*.stories.{js,jsx,ts,tsx}';
const CODE_GLOB = '**/*.{js,jsx,ts,tsx,mjs,cjs}';
const TWIG_GLOB = '**/*.twig';
const STYLE_GLOB = '**/*.{css,scss,sass}';

export const DEFAULT_TWIG_THRESHOLD = 250;

export const auditChecks = [
  auditProjectConfig,
  auditPackageOverrides,
  auditGeneratedPackageScripts,
  auditStoryDiscovery,
  auditLegacyTwigStories,
  auditTwigReferences,
  auditCssAssetReferences,
  auditWebpackPatterns,
  auditCoreImports,
  auditDrupalAssumptions,
  auditFilesOutsideRoots,
  auditTwigVolume,
];

/**
 * Normalize the project config, retaining any resolution failure.
 *
 * @param {string} projectDir - Absolute project root.
 * @returns {{env: object, configExists: boolean, error?: Error}}
 */
function resolveAuditEnvironment(projectDir) {
  const configExists = safeExists(resolve(projectDir, 'project.emulsify.json'));

  try {
    return {
      env: resolveProjectConfig(projectDir, process.env),
      configExists,
    };
  } catch (error) {
    return {
      env: {
        projectDir,
        platform: 'none',
        namespaceRoots: {},
        projectStructure: {},
      },
      configExists,
      error,
    };
  }
}

/**
 * Build the shared context passed to every audit check.
 *
 * @param {{projectDir?: string, twigThreshold?: number}} [options={}] - Options.
 * @returns {object} Audit context.
 */
export function createAuditContext(options = {}) {
  const projectDir = resolve(options.projectDir || process.cwd());
  const envResult = resolveAuditEnvironment(projectDir);
  const structure = envResult.env.projectStructure || {};
  const sourceRoots = normalizeAuditRoots(
    projectDir,
    structure.sourceRoots || [],
  );
  const storyRoots = normalizeAuditRoots(
    projectDir,
    structure.storyRoots || sourceRoots,
  );
  const twigRoots = normalizeAuditRoots(
    projectDir,
    structure.twigRoots || sourceRoots,
  );
  const storyFiles = collectRootedProjectFiles(
    projectDir,
    STORY_GLOB,
    storyRoots,
  );
  const codeFiles = collectRootedProjectFiles(
    projectDir,
    CODE_GLOB,
    sourceRoots,
  );
  const twigFiles = collectRootedProjectFiles(projectDir, TWIG_GLOB, twigRoots);
  const styleFiles = collectRootedProjectFiles(
    projectDir,
    STYLE_GLOB,
    sourceRoots,
  );

  return {
    ...envResult,
    projectDir,
    sourceRoots,
    storyRoots,
    twigRoots,
    storyFiles,
    codeFiles,
    twigFiles,
    styleFiles,
    twigThreshold: Number.isFinite(options.twigThreshold)
      ? options.twigThreshold
      : DEFAULT_TWIG_THRESHOLD,
  };
}

/**
 * Run all registered checks against a prepared audit context.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
export function runAuditChecks(context) {
  return auditChecks.flatMap((check) => check(context));
}

/**
 * Run the combined Emulsify audit.
 *
 * @param {{projectDir?: string, twigThreshold?: number}} [options={}] - Options.
 * @returns {{projectDir: string, summary: object, files: object, findings: object[]}} Audit result.
 */
export function runAudits(options = {}) {
  resetFileReadCache();

  const context = createAuditContext(options);
  const findings = runAuditChecks(context);
  const summary = findings.reduce(
    (totals, finding) => ({
      ...totals,
      [finding.severity]: (totals[finding.severity] || 0) + 1,
    }),
    {
      error: 0,
      warn: 0,
      info: 0,
    },
  );

  return {
    projectDir: context.projectDir,
    summary,
    files: {
      stories: context.storyFiles.length,
      twig: context.twigFiles.length,
      code: context.codeFiles.length,
      styles: context.styleFiles.length,
    },
    findings,
  };
}

export { runAudits as auditProject };
