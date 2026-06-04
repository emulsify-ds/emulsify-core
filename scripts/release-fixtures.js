/**
 * @file Release-readiness fixture builds for Emulsify Core.
 */

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';
import { safeExists } from '../config/vite/utils/fs-safe.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesRoot = join(repoRoot, '.github/fixtures/release');
const viteBin = join(repoRoot, 'node_modules/vite/bin/vite.js');
const storybookBin = join(repoRoot, 'node_modules/.bin/storybook');
const viteConfig = join(repoRoot, 'config/vite/vite.config.js');
const storybookConfigDir = join(repoRoot, '.storybook');
const largeTwigComponentCount = 80;

const releaseFixtures = [
  {
    name: 'drupal-sdc-src-components',
    type: 'vite',
    assert: [
      'components/card/card.js',
      'components/card/card.css',
      'components/card/card.twig',
      'components/card/card.component.yml',
      'components/card/card.asset.txt',
    ],
    reject: [
      'dist/components/card/card.js',
      'dist/components/card/card.css',
      'dist/components/card/card.twig',
      'dist/components/card/card.component.yml',
      'dist/components/card/card.asset.txt',
    ],
  },
  {
    name: 'generic-src-components',
    type: 'vite',
    assert: [
      'dist/components/card/js/card.js',
      'dist/components/card/js/ReactCard.js',
      'dist/components/card/js/mount.js',
      'dist/components/card/css/card.css',
      'dist/components/card/card.twig',
      'dist/components/card/card.asset.txt',
      'dist/global/base/js/base.js',
      'dist/global/base/css/base.css',
      'dist/extension-marker.txt',
    ],
    reject: [
      'components/card/card.js',
      'dist/components/card/ReactCard.jsx',
      'dist/components/card/mount.jsx',
      'dist/components/card/js/card2.js',
    ],
    rejectContent: [
      {
        pattern: 'dist/**/*.js',
        strings: ['window.Drupal', 'Drupal.behaviors', 'attachBehaviors'],
      },
    ],
  },
  {
    name: 'legacy-components',
    type: 'vite',
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
    type: 'vite',
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
  {
    name: 'mixed-storybook',
    type: 'storybook',
    assert: ['.out/iframe.html'],
    match: ['.out/assets/card.stories-*.js'],
    assertContent: [
      {
        pattern: '.out/assets/card.stories-*.js',
        strings: ['Twig fixture', 'React fixture'],
      },
    ],
  },
  {
    name: 'large-twig-storybook',
    type: 'storybook',
    setup: setupLargeTwigStorybookFixture,
    assert: ['.out/iframe.html'],
    match: ['.out/assets/gallery.stories-*.js'],
    measure: true,
    metricComponentCount: largeTwigComponentCount,
  },
];

function usage() {
  return [
    'Usage: node scripts/release-fixtures.js [--fixture <name>] [--list]',
    '',
    'Options:',
    '  --fixture <name>  Run one fixture by name. Can be repeated or comma-separated.',
    '  --list            Print fixture names and exit.',
    '  --help            Print this help text.',
  ].join('\n');
}

function parseFixtureNames(value) {
  return String(value || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const fixtureNames = [];
  let list = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--list') {
      list = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--fixture') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--fixture requires a fixture name.');
      }
      fixtureNames.push(...parseFixtureNames(value));
      index += 1;
      continue;
    }
    if (arg.startsWith('--fixture=')) {
      fixtureNames.push(...parseFixtureNames(arg.slice('--fixture='.length)));
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return { fixtureNames, help, list };
}

function selectedFixtures(fixtureNames) {
  if (!fixtureNames.length) {
    return releaseFixtures;
  }

  const fixturesByName = new Map(
    releaseFixtures.map((fixture) => [fixture.name, fixture]),
  );
  const selected = [];

  for (const fixtureName of fixtureNames) {
    const fixture = fixturesByName.get(fixtureName);
    if (!fixture) {
      const available = releaseFixtures.map(({ name }) => name).join(', ');
      throw new Error(
        `Unknown fixture "${fixtureName}". Available: ${available}`,
      );
    }
    selected.push(fixture);
  }

  return selected;
}

function copyFixture(fixture) {
  const { name, setup } = fixture;
  const source = join(fixturesRoot, name);
  const target = mkdtempSync(join(tmpdir(), `emulsify-core-${name}-`));
  cpSync(source, target, { recursive: true });
  if (typeof setup === 'function') {
    setup(target);
  }
  linkFixturePackages(target);
  return target;
}

function setupLargeTwigStorybookFixture(projectDir) {
  const componentsDir = join(projectDir, 'src/components');

  for (let index = 1; index <= largeTwigComponentCount; index += 1) {
    const id = String(index).padStart(3, '0');
    const componentName = `item-${id}`;
    const componentDir = join(componentsDir, componentName);
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(
      join(componentDir, `${componentName}.twig`),
      [
        '<article class="large-item large-item--{{ variant|default(\'standard\') }}">',
        `  {{ include('@components/${componentName}/_content.twig', {`,
        `    label: label|default('Item ${id}'),`,
        `    index: ${index}`,
        '  }) }}',
        '</article>',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(componentDir, '_content.twig'),
      [
        `<span data-large-item="${id}">`,
        '  {{ label }} #{{ index }}',
        '</span>',
        '',
      ].join('\n'),
    );
  }
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
    if (!safeExists(absPath)) {
      throw new Error(`Expected fixture output missing: ${relPath}`);
    }
  }
}

function assertMissing(projectDir, relPaths = []) {
  for (const relPath of relPaths) {
    const absPath = join(projectDir, relPath);
    if (safeExists(absPath)) {
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

function readPatternContents(projectDir, pattern) {
  const matches = globSync(pattern, {
    cwd: projectDir,
    nodir: true,
  });

  if (!matches.length) {
    throw new Error(`Expected fixture output pattern missing: ${pattern}`);
  }

  return matches
    .map((match) => readFileSync(join(projectDir, match), 'utf8'))
    .join('\n');
}

function assertContent(projectDir, assertions = []) {
  for (const { pattern, strings = [] } of assertions) {
    const contents = readPatternContents(projectDir, pattern);

    for (const expectedString of strings) {
      if (!contents.includes(expectedString)) {
        throw new Error(
          `Expected fixture output pattern ${pattern} to contain "${expectedString}".`,
        );
      }
    }
  }
}

function assertNoContent(projectDir, assertions = []) {
  for (const { pattern, strings = [] } of assertions) {
    const contents = readPatternContents(projectDir, pattern);

    for (const rejectedString of strings) {
      if (contents.includes(rejectedString)) {
        throw new Error(
          `Unexpected fixture output pattern ${pattern} contains "${rejectedString}".`,
        );
      }
    }
  }
}

function directorySize(directory) {
  let total = 0;

  for (const entryName of readdirSync(directory)) {
    const entryPath = join(directory, entryName);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      total += directorySize(entryPath);
    } else {
      total += stats.size;
    }
  }

  return total;
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function runViteFixture(fixture) {
  const projectDir = copyFixture(fixture);
  try {
    console.log(`→ Running Vite fixture: ${fixture.name}`);
    run(
      process.execPath,
      [viteBin, 'build', '--config', viteConfig],
      projectDir,
    );
    assertExists(projectDir, fixture.assert);
    assertMissing(projectDir, fixture.reject);
    assertContent(projectDir, fixture.assertContent);
    assertNoContent(projectDir, fixture.rejectContent);
    console.log(`✓ Vite fixture passed: ${fixture.name}`);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

function runStorybookFixture(fixture) {
  const projectDir = copyFixture(fixture);
  const outputDir = join(projectDir, '.out');
  try {
    console.log(`→ Running Storybook fixture: ${fixture.name}`);
    const startedAt = process.hrtime.bigint();
    run(
      storybookBin,
      ['build', '--config-dir', storybookConfigDir, '-o', outputDir],
      projectDir,
    );
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    assertExists(projectDir, fixture.assert);
    assertMatches(projectDir, fixture.match);
    assertContent(projectDir, fixture.assertContent);
    assertNoContent(projectDir, fixture.rejectContent);
    if (fixture.measure) {
      const outputSize = directorySize(outputDir);
      console.log(
        `  Storybook metrics (${fixture.name}): ${(durationMs / 1000).toFixed(
          2,
        )}s, ${formatBytes(outputSize)} output${
          fixture.metricComponentCount
            ? `, ${fixture.metricComponentCount} generated Twig components`
            : ''
        }`,
      );
    }
    console.log(`✓ Storybook fixture passed: ${fixture.name}`);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

function runFixture(fixture) {
  if (fixture.type === 'vite') {
    runViteFixture(fixture);
    return;
  }
  if (fixture.type === 'storybook') {
    runStorybookFixture(fixture);
    return;
  }

  throw new Error(
    `Unsupported fixture type "${fixture.type}" for ${fixture.name}.`,
  );
}

try {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage());
    process.exit(0);
  }
  if (options.list) {
    console.log(releaseFixtures.map(({ name }) => name).join('\n'));
    process.exit(0);
  }

  const fixturesToRun = selectedFixtures(options.fixtureNames);
  const label =
    fixturesToRun.length === releaseFixtures.length
      ? 'full release fixture suite'
      : fixturesToRun.map(({ name }) => name).join(', ');

  console.log(`Running ${fixturesToRun.length} fixture(s): ${label}`);
  for (const fixture of fixturesToRun) {
    runFixture(fixture);
  }
} catch (error) {
  console.error(error.message || error);
  console.error('');
  console.error(usage());
  process.exit(1);
}
