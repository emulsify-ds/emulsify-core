/**
 * @file Release-readiness fixture builds for Emulsify Core.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesRoot = join(repoRoot, 'fixtures/release');
const viteBin = join(repoRoot, 'node_modules/vite/bin/vite.js');
const storybookBin = join(repoRoot, 'node_modules/.bin/storybook');
const viteConfig = join(repoRoot, 'config/vite/vite.config.js');
const storybookConfigDir = join(repoRoot, '.storybook');

const viteFixtures = [
  {
    name: 'drupal-sdc-src-components',
    assert: [
      'components/card/card.js',
      'components/card/card.css',
      'components/card/card.twig',
      'components/card/card.component.yml',
      'components/card/card.asset.txt',
    ],
    reject: ['dist/components/card/card.js'],
  },
  {
    name: 'generic-src-components',
    assert: [
      'dist/components/card/js/card.js',
      'dist/components/card/css/card.css',
      'dist/components/card/card.twig',
      'dist/components/card/card.asset.txt',
      'dist/global/base/js/base.js',
      'dist/global/base/css/base.css',
    ],
    reject: ['components/card/card.js'],
  },
  {
    name: 'legacy-components',
    assert: [
      'dist/components/banner/js/banner.js',
      'dist/components/banner/css/banner.css',
      'dist/components/banner/banner.twig',
      'dist/components/banner/banner.asset.txt',
    ],
    reject: ['components/banner/js/banner.js'],
  },
  {
    name: 'structure-implementations',
    assert: [
      'dist/js/button/button.js',
      'dist/css/button/button.css',
      'dist/components/button/button.twig',
      'dist/components/button/button.asset.txt',
      'dist/js/src/foundation/colors/colors.js',
      'dist/css/src/foundation/colors/colors.css',
      'dist/foundation/colors/palette.json',
      'dist/layout/grid/grid.twig',
      'dist/storybook/src/layout/grid/sb-grid.css',
      'dist/tokens/spacing/spacing.json',
    ],
    reject: ['components/button/button.js'],
  },
];

const storybookFixtures = [
  {
    name: 'mixed-storybook',
    assert: ['.out/iframe.html'],
    match: ['.out/assets/card.stories-*.js'],
  },
];

function copyFixture(name) {
  const source = join(fixturesRoot, name);
  const target = mkdtempSync(join(tmpdir(), `emulsify-core-${name}-`));
  cpSync(source, target, { recursive: true });
  linkFixturePackages(target);
  return target;
}

function linkFixturePackages(projectDir) {
  const nodeModulesDir = join(projectDir, 'node_modules');
  const scopeDir = join(nodeModulesDir, '@emulsify');
  mkdirSync(scopeDir, { recursive: true });
  linkPackage(repoRoot, join(scopeDir, 'core'));

  for (const dependency of [
    '@storybook',
    '@vitejs',
    'react',
    'react-dom',
    'storybook',
    'twig',
    'vite',
  ]) {
    linkPackage(
      join(repoRoot, 'node_modules', dependency),
      join(nodeModulesDir, dependency),
    );
  }
}

function linkPackage(source, target) {
  try {
    symlinkSync(source, target, 'junction');
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      FORCE_COLOR: '0',
      NODE_OPTIONS: '--no-deprecation',
    },
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd} with exit ${result.status}`,
    );
  }

  return result;
}

function assertExists(projectDir, relPaths) {
  for (const relPath of relPaths) {
    const absPath = join(projectDir, relPath);
    if (!existsSync(absPath)) {
      throw new Error(`Expected fixture output missing: ${relPath}`);
    }
  }
}

function assertMissing(projectDir, relPaths = []) {
  for (const relPath of relPaths) {
    const absPath = join(projectDir, relPath);
    if (existsSync(absPath)) {
      throw new Error(`Unexpected fixture output exists: ${relPath}`);
    }
  }
}

function assertMatches(projectDir, patterns = []) {
  for (const pattern of patterns) {
    const matches = globSync(pattern, {
      cwd: projectDir,
      nodir: true,
    });
    if (!matches.length) {
      throw new Error(`Expected fixture output pattern missing: ${pattern}`);
    }
  }
}

function runViteFixture(fixture) {
  const projectDir = copyFixture(fixture.name);
  try {
    run(process.execPath, [viteBin, 'build', '--config', viteConfig], projectDir);
    assertExists(projectDir, fixture.assert);
    assertMissing(projectDir, fixture.reject);
    console.log(`✓ Vite fixture passed: ${fixture.name}`);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

function runStorybookFixture(fixture) {
  const projectDir = copyFixture(fixture.name);
  const outputDir = join(projectDir, '.out');
  try {
    run(
      storybookBin,
      ['build', '--config-dir', storybookConfigDir, '-o', outputDir],
      projectDir,
    );
    assertExists(projectDir, fixture.assert);
    assertMatches(projectDir, fixture.match);
    console.log(`✓ Storybook fixture passed: ${fixture.name}`);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

for (const fixture of viteFixtures) {
  runViteFixture(fixture);
}

for (const fixture of storybookFixtures) {
  runStorybookFixture(fixture);
}
