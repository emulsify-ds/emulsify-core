/**
 * @file Smoke tests for the generated project initialization hook.
 */

import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

describe('Emulsify CLI init hook', () => {
  it('runs inside an ESM package and renames generated project files', () => {
    const packageRoot = path.join(__dirname, '..');
    const projectDir = mkdtempSync(
      path.join(tmpdir(), 'emulsify-core-cli-init-'),
    );

    try {
      mkdirSync(path.join(projectDir, '.cli'), { recursive: true });
      mkdirSync(path.join(projectDir, 'config'), { recursive: true });
      symlinkSync(
        path.join(packageRoot, 'node_modules'),
        path.join(projectDir, 'node_modules'),
        'junction',
      );

      copyFileSync(
        path.join(__dirname, 'init.js'),
        path.join(projectDir, '.cli/init.js'),
      );
      writeFileSync(
        path.join(projectDir, 'package.json'),
        `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
      );
      writeFileSync(
        path.join(projectDir, 'config/project.emulsify.json'),
        `${JSON.stringify(
          {
            project: {
              name: 'Demo Theme',
              machineName: 'demo_theme',
            },
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        path.join(projectDir, 'emulsify.info.yml'),
        ['name: Emulsify', 'libraries:', '  - emulsify/global', ''].join('\n'),
      );
      writeFileSync(path.join(projectDir, 'emulsify.theme'), '');
      writeFileSync(
        path.join(projectDir, 'emulsify.breakpoints.yml'),
        [
          'emulsify.mobile:',
          '  label: Mobile',
          '  mediaQuery: all',
          '  weight: 0',
          '  multipliers:',
          '    - 1x',
          '',
        ].join('\n'),
      );
      writeFileSync(path.join(projectDir, 'emulsify.libraries.yml'), '');

      execFileSync(process.execPath, ['.cli/init.js'], {
        cwd: projectDir,
        env: {
          ...process.env,
          NODE_OPTIONS: '--no-deprecation',
        },
      });

      expect(existsSync(path.join(projectDir, 'emulsify.info.yml'))).toBe(
        false,
      );
      expect(existsSync(path.join(projectDir, 'demo_theme.info.yml'))).toBe(
        true,
      );
      expect(existsSync(path.join(projectDir, 'demo_theme.theme'))).toBe(true);
      expect(
        existsSync(path.join(projectDir, 'demo_theme.breakpoints.yml')),
      ).toBe(true);
      expect(
        existsSync(path.join(projectDir, 'demo_theme.libraries.yml')),
      ).toBe(true);

      const info = readFileSync(
        path.join(projectDir, 'demo_theme.info.yml'),
        'utf8',
      );
      const breakpoints = readFileSync(
        path.join(projectDir, 'demo_theme.breakpoints.yml'),
        'utf8',
      );

      expect(info).toContain('name: demo_theme');
      expect(info).toContain('- demo_theme/global');
      expect(breakpoints).toContain('demo_theme.mobile:');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
