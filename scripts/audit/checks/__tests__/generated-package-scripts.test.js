/**
 * @file Tests for the generated package scripts audit check.
 */

import { auditGeneratedPackageScripts } from '../generated-package-scripts.js';
import {
  makeTempProject,
  removeTempProject,
  writeFile,
} from '../../test-utils.js';

describe('auditGeneratedPackageScripts', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  it('reports stale generated package scripts for Core consumers', () => {
    writeFile(
      projectDir,
      'package.json',
      JSON.stringify({
        name: 'legacy-theme',
        scripts: {
          build:
            'npm run ensure-dist && webpack --config node_modules/@emulsify/core/config/webpack/webpack.prod.js',
          'build-dev':
            'npm run ensure-dist && webpack --config node_modules/@emulsify/core/config/webpack/webpack.dev.js',
          develop:
            'npm run ensure-dist && concurrently --raw --no-shell npm:webpack npm:storybook',
          webpack:
            'webpack --watch --config node_modules/@emulsify/core/config/webpack/webpack.dev.js',
        },
        dependencies: {
          '@emulsify/core': '^3.5.0',
        },
      }),
    );

    const finding = auditGeneratedPackageScripts({
      env: {},
      projectDir,
    })[0];

    expect(finding.details).toEqual(
      expect.arrayContaining([
        'Replace scripts.build with the Vite build command.',
        'Remove scripts.build-dev; the Vite build replaces it.',
        'Replace scripts.develop with the Vite/Storybook watcher.',
        'Replace scripts.webpack with scripts.vite.',
        'Add scripts.audit.',
        'Add scripts.audit:twig-stories.',
        'Add scripts.vite.',
      ]),
    );
    expect(finding.docs).toContain('#manual-packagejson-updates');
  });

  it('accepts current generated package scripts for Core consumers', () => {
    writeFile(
      projectDir,
      'package.json',
      JSON.stringify({
        name: 'current-theme',
        scripts: {
          audit:
            'sh -c \'node_modules/@emulsify/core/scripts/audit.js "$@"; status=$?; printf "\\nAudit docs: https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/audit.md\\n" >&2; exit $status\' --',
          'audit:twig-stories':
            'sh -c \'node_modules/@emulsify/core/scripts/audit-twig-stories.js "$@"; status=$?; printf "\\nMigration docs: https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/storybook.md#legacy-twig-story-compatibility\\n" >&2; exit $status\' --',
          build:
            'npm run ensure-dist && vite build --config node_modules/@emulsify/core/config/vite/vite.config.js',
          develop:
            'npm run ensure-dist && concurrently --raw --no-shell npm:vite npm:storybook',
          vite: 'vite build --watch --config node_modules/@emulsify/core/config/vite/vite.config.js',
        },
        dependencies: {
          '@emulsify/core': '^4.0.0',
        },
      }),
    );

    expect(auditGeneratedPackageScripts({ env: {}, projectDir })).toEqual([]);
  });

  it('reports generated build scripts missing the Vite build subcommand', () => {
    writeFile(
      projectDir,
      'package.json',
      JSON.stringify({
        name: 'generated-theme-missing-vite-build-command',
        scripts: {
          audit: 'node_modules/@emulsify/core/scripts/audit.js',
          'audit:twig-stories':
            'node_modules/@emulsify/core/scripts/audit-twig-stories.js',
          build:
            'npm run ensure-dist && vite --config node_modules/@emulsify/core/config/vite/vite.config.js',
          develop:
            'npm run ensure-dist && concurrently --raw --no-shell npm:vite npm:storybook',
          vite: 'vite build --watch --config node_modules/@emulsify/core/config/vite/vite.config.js',
        },
        dependencies: {
          '@emulsify/core': '^4.0.0',
        },
      }),
    );

    const finding = auditGeneratedPackageScripts({ env: {}, projectDir })[0];

    expect(finding.details).toEqual([
      'Replace scripts.build with the Vite build command.',
    ]);
  });

  it('does not require generated package scripts for custom Core consumers', () => {
    writeFile(
      projectDir,
      'package.json',
      JSON.stringify({
        name: 'custom-core-consumer',
        scripts: {
          build: 'vite build',
        },
        dependencies: {
          '@emulsify/core': '^4.0.0',
        },
      }),
    );

    expect(auditGeneratedPackageScripts({ env: {}, projectDir })).toEqual([]);
  });
});
