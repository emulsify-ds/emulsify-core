/* eslint-disable */

/**
 * @file Environment resolver for Emulsify's Vite build.
 * @description Centralizes project path resolution and platform flags (Drupal vs generic).
 */

import fs from 'fs';
import { resolve } from 'path';

/**
 * Resolve project paths and Emulsify environment flags.
 *
 * @returns {{
 *   projectDir: string,
 *   emulsifyConfigPath: string,
 *   emulsifyConfig: any,
 *   isDrupal: boolean,
 *   srcDir: string,
 *   srcExists: boolean
 * }}
 */
export function resolveEnvironment() {
  const projectDir = resolve(process.cwd());
  const emulsifyConfigPath = resolve(projectDir, 'project.emulsify.json');
  const emulsifyConfig = fs.existsSync(emulsifyConfigPath)
    ? JSON.parse(fs.readFileSync(emulsifyConfigPath, 'utf-8'))
    : { project: { platform: 'generic' } };

  const isDrupal = emulsifyConfig?.project?.platform === 'drupal';

  const srcPath = resolve(projectDir, 'src');
  const srcExists = fs.existsSync(srcPath);
  const srcDir = srcExists ? srcPath : resolve(projectDir, 'components');

  return {
    projectDir,
    emulsifyConfigPath,
    emulsifyConfig,
    isDrupal,
    srcDir,
    srcExists,
  };
}
