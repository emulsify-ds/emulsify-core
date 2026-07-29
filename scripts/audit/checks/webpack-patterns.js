/**
 * @file Webpack-era pattern audit check.
 */

import { resolve } from 'node:path';
import { safeExists } from '../../../config/vite/utils/fs-safe.js';
import { lineNumberAt } from '../../lib/text.js';
import { makeFinding } from '../lib/findings.js';
import { cachedReadFile, safeIsDirectory } from '../lib/files.js';

/**
 * Audit Webpack-era files and code patterns.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
export function auditWebpackPatterns(context) {
  const { codeFiles, projectDir } = context;
  const findings = [];
  const webpackConfig = resolve(projectDir, '.storybook/webpack.config.js');
  const webpackDir = resolve(projectDir, 'config/webpack');

  if (safeExists(webpackConfig)) {
    findings.push(
      makeFinding({
        id: 'webpack-config-file',
        severity: 'warn',
        filePath: webpackConfig,
        message:
          'Webpack-specific Storybook config is present and should be migrated to Vite/Storybook overrides.',
        docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/migration-4x.md#vite-customization',
      }),
    );
  }

  if (safeIsDirectory(webpackDir)) {
    findings.push(
      makeFinding({
        id: 'webpack-config-directory',
        severity: 'warn',
        filePath: webpackDir,
        message:
          'config/webpack exists. Webpack-specific customization should move to Vite plugins or extendConfig().',
        docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/extension-points.md#vite-plugins-and-config-patches',
      }),
    );
  }

  const patterns = [
    {
      regex: /\brequire\.context\s*\(/,
      message: 'require.context() is Webpack-specific and should be migrated.',
    },
    {
      regex:
        /\b(raw-loader|twig-loader|style-loader|file-loader|sass-loader)\b/,
      message: 'Webpack loader references should be migrated to Vite plugins.',
    },
    {
      regex: /from\s+['"][^'"]+![^'"]+['"]|import\s+['"][^'"]+![^'"]+['"]/,
      message: 'Inline Webpack loader import syntax should be removed.',
    },
  ];

  for (const filePath of codeFiles) {
    const source = cachedReadFile(filePath);

    for (const pattern of patterns) {
      const match = pattern.regex.exec(source);
      if (!match) continue;

      findings.push(
        makeFinding({
          id: 'webpack-era-pattern',
          severity: 'warn',
          filePath,
          line: lineNumberAt(source, match.index || 0),
          message: pattern.message,
          docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/migration-4x.md#vite-customization',
        }),
      );
    }
  }

  return findings;
}
