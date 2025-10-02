/**
 * @file Environment resolution for Emulsify + Vite.
 * @description
 * - No longer reads `singleDirectoryComponents` or `isDrupal` from project.emulsify.json.
 * - Only derives `platform` and checks `platform === 'drupal'` when needed.
 */

import fs from 'fs';
import { resolve } from 'path';

/**
 * Resolve environment details for the current project.
 * - `projectDir` is the current working directory (Vite root).
 * - `srcDir` prefers `<project>/src` if it exists, else `<project>/components`.
 * - `platform` is pulled from:
 *      1) process.env.EMULSIFY_PLATFORM (if present),
 *      2) project.emulsify.json -> { project: { platform } } (if present),
 *      3) defaults to "generic".
 *
 * @returns {{
 *   projectDir: string,
 *   srcDir: string,
 *   srcExists: boolean,
 *   platform: 'drupal' | 'generic' | string
 * }}
 */
export function resolveEnvironment() {
  const projectDir = process.cwd();

  // src/ preferred; fallback to components/ for legacy repos
  const srcPath = resolve(projectDir, 'src');
  const srcExists = fs.existsSync(srcPath);
  const srcDir = srcExists ? srcPath : resolve(projectDir, 'components');

  // Determine platform:
  // 1) env var (highest precedence)
  // 2) project.emulsify.json (if present)
  // 3) default 'generic'
  let platform = (process.env.EMULSIFY_PLATFORM || '')
    .toString()
    .toLowerCase()
    .trim();

  if (!platform) {
    try {
      const cfgPath = resolve(projectDir, 'project.emulsify.json');
      if (fs.existsSync(cfgPath)) {
        const raw = fs.readFileSync(cfgPath, 'utf8');
        const json = JSON.parse(raw);
        platform = (json?.project?.platform || json?.platform || '')
          .toString()
          .toLowerCase()
          .trim();
      }
    } catch {
      // ignore JSON read/parse issues; fall through to default
    }
  }

  if (!platform) platform = 'generic';

  return { projectDir, srcDir, srcExists, platform };
}
