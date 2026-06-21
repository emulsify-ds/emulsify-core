/**
 * @file Environment resolution for Emulsify + Vite.
 *
 * Reads project settings and exposes a normalized "env" object used by
 * entries, plugins, and the Vite config.
 *
 * Highlights:
 *  - `platform`: from env var or project.emulsify.json (default "none").
 *  - `SDC`: boolean from project.emulsify.json `project.singleDirectoryComponents`.
 *  - `structureOverrides`: true when safe `variant.structureImplementations` exist.
 *  - `structureRoots`: array of directories from `variant.structureImplementations`.
 *  - `platformAdapter`: active adapter for platform-specific behavior.
 */

import { resolveProjectConfig } from './project-config.js';

/**
 * Resolve environment details for the current project.
 *
 * @returns {{
 *   projectDir: string,
 *   srcDir: string,
 *   srcExists: boolean,
 *   platform: 'drupal' | 'none' | string,
 *   SDC: boolean,
 *   structureOverrides: boolean,
 *   structureRoots: string[],
 *   structureImplementations: Array<{name: string, directory: string}>,
 *   componentRoots: string[],
 *   globalRoots: string[],
 *   namespaceRoots: Record<string, string>,
 *   outputStrategy: string,
 *   projectStructure: object,
 *   platformAdapter: object
 * }}
 */
export function resolveEnvironment() {
  return resolveProjectConfig(process.cwd(), process.env);
}
