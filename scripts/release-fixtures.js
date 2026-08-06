/**
 * @file Release-readiness fixture builds for Emulsify Core.
 */

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';
import { safeExists } from '../config/vite/utils/fs-safe.js';
import { createUsage, parseArgs as parseCliArgs } from './lib/cli.js';
import { directorySize } from './lib/fs.js';
import { run } from './lib/proc.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesRoot = join(repoRoot, '.github/fixtures/release');
const viteBin = join(repoRoot, 'node_modules/vite/bin/vite.js');
const storybookBin = join(repoRoot, 'node_modules/.bin/storybook');
const viteConfig = join(repoRoot, 'config/vite/vite.config.js');
const storybookConfigDir = join(repoRoot, '.storybook');
const customElementBrowserTest = join(
  repoRoot,
  'scripts/test-custom-element-storybook.js',
);
const largeTwigComponentCount = 80;
// Storybook 10.5 changes its own manager/runtime chunks under Vite 8, so keep
// the regression gate focused on fixture-owned output. The exclusive ceiling
// preserves the original 484-byte budget over the current 181,845-byte result.
const largeTwigStorybookFixtureJsLimit = 182_329;
const largeTwigStorybookFixtureJsPatterns = [
  'storybook-assets/_content-*.js',
  'storybook-assets/gallery-*.js',
  'storybook-assets/gallery.stories-*.js',
  'storybook-assets/item-*.js',
];

// The lint rule bans double-quoted strings, and these patterns need a literal
// single quote to match single-quoted CSS.
const QUOTE = String.fromCharCode(39);

/**
 * Reject every CSS asset URL form that is wrong for a given stylesheet.
 *
 * Each fixture authors the same three URLs — canonical, bare, and a
 * deliberately wrong-depth relative one — and the build must converge all three
 * on the depth that stylesheet actually needs. These rejects are anchored on
 * `url(` and repeated per quote style, so a correct deeper path can never
 * satisfy them and minifier quoting cannot make them vacuous.
 *
 * @param {string} pattern - Emitted stylesheet to check.
 * @returns {{pattern: string, strings: string[]}} Reject rule.
 */
const rejectWrongAssetUrls = (pattern) => ({
  pattern,
  strings: [
    'url(../assets/',
    'url("../assets/',
    `url(${QUOTE}../assets/`,
    'url(/assets/',
    'url("/assets/',
    `url(${QUOTE}/assets/`,
    'url(assets/',
    'url("assets/',
    `url(${QUOTE}assets/`,
  ],
});

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
      // dist/ is build output: the theme's own assets/ directory is source and
      // is already web-served, so no copy of it belongs here.
      'dist/assets/images/canonical.svg',
      'dist/assets/images/bare.svg',
      'dist/assets/images/relative.svg',
      'dist/components/card/card.js',
      'dist/components/card/card.css',
      'dist/components/card/card.twig',
      'dist/components/card/card.component.yml',
      'dist/components/card/card.asset.txt',
    ],
    assertContent: [
      {
        // Mirrored component CSS already sits at the theme root, two levels
        // above assets/, so its depth is unchanged by leaving dist/ alone.
        pattern: 'components/card/card.css',
        strings: [
          '../../assets/images/canonical.svg',
          '../../assets/images/bare.svg',
          '../../assets/images/relative.svg',
        ],
      },
    ],
    rejectContent: [rejectWrongAssetUrls('components/card/card.css')],
  },
  {
    name: 'no-platform-src-components',
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
      'dist/assets/images/canonical.svg',
      'dist/assets/images/bare.svg',
      'dist/assets/images/relative.svg',
      'components/card/card.js',
      'dist/components/card/ReactCard.jsx',
      'dist/components/card/mount.jsx',
      'dist/components/card/js/card2.js',
    ],
    assertContent: [
      {
        pattern: 'dist/global/base/css/base.css',
        strings: ['.sass-glob-fixture', '.legacy-sass-glob-fixture'],
      },
      {
        // Bucketed component CSS sits four levels below the theme root once
        // dist/ is counted, and reaches the source assets/ from there.
        pattern: 'dist/components/card/css/card.css',
        strings: [
          '../../../../assets/images/canonical.svg',
          '../../../../assets/images/bare.svg',
          '../../../../assets/images/relative.svg',
        ],
      },
    ],
    rejectContent: [
      {
        pattern: 'dist/**/*.js',
        strings: ['window.Drupal', 'Drupal.behaviors', 'attachBehaviors'],
      },
      rejectWrongAssetUrls('dist/components/card/css/card.css'),
    ],
  },
  {
    name: 'wordpress-src-components',
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
      'components/card/ReactCard.js',
      'components/card/mount.js',
      'components/card/card.css',
      'components/card/card.twig',
      'components/card/card.asset.txt',
      'dist/components/card/ReactCard.jsx',
      'dist/components/card/mount.jsx',
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
    reject: [
      'dist/assets/images/canonical.svg',
      'dist/assets/images/bare.svg',
      'dist/assets/images/relative.svg',
      'components/button/button.js',
    ],
    assertContent: [
      {
        // Structure-override CSS depth is not uniform: this root keeps its
        // `src/` segment, so the same authored URLs climb five levels.
        pattern: 'dist/css/src/foundation/colors/colors.css',
        strings: [
          '../../../../../assets/images/canonical.svg',
          '../../../../../assets/images/bare.svg',
          '../../../../../assets/images/relative.svg',
        ],
      },
    ],
    rejectContent: [
      rejectWrongAssetUrls('dist/css/src/foundation/colors/colors.css'),
    ],
  },
  {
    name: 'mixed-storybook',
    type: 'storybook',
    assert: ['.out/iframe.html'],
    match: [
      '.out/storybook-assets/card.stories-*.js',
      '.out/storybook-assets/greeting-card.stories-*.js',
    ],
    assertContent: [
      {
        pattern: '.out/storybook-assets/card.stories-*.js',
        strings: ['Twig fixture', 'React fixture'],
      },
      {
        pattern: '.out/storybook-assets/greeting-card.stories-*.js',
        strings: [
          'Custom element fixture',
          'Default slot content',
          'greeting-select',
        ],
      },
      {
        pattern: '.out/storybook-assets/*.js',
        strings: ['data-nested-project-alias'],
      },
    ],
    browserTest: customElementBrowserTest,
  },
  {
    name: 'large-twig-storybook',
    type: 'storybook',
    setup: setupLargeTwigStorybookFixture,
    assert: ['.out/iframe.html'],
    match: ['.out/storybook-assets/gallery.stories-*.js'],
    measure: true,
    metricComponentCount: largeTwigComponentCount,
    javascriptMeasurePatterns: largeTwigStorybookFixtureJsPatterns,
    maxMeasuredJavaScriptBytes: largeTwigStorybookFixtureJsLimit,
  },
];

function usage() {
  return createUsage(
    'Usage: node scripts/release-fixtures.js [--fixture <name>] [--list]',
    [
      '  --fixture <name>  Run one fixture by name. Can be repeated or comma-separated.',
      '  --list            Print fixture names and exit.',
      '  --help            Print this help text.',
    ],
  );
}

function parseFixtureNames(value) {
  return String(value || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  return parseCliArgs(argv, {
    defaults: {
      fixtureNames: [],
      help: false,
      list: false,
    },
    flags: {
      '--list': 'list',
    },
    options: {
      '--fixture': {
        key: 'fixtureNames',
        append: true,
        parse: parseFixtureNames,
        missingMessage: '--fixture requires a fixture name.',
      },
    },
  });
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

function fixtureRunOptions(cwd) {
  return {
    cwd,
    env: {
      ...process.env,
      CI: '1',
      FORCE_COLOR: '0',
      NODE_OPTIONS: '--no-deprecation',
    },
    echoOutputOnFailure: true,
    failureMessage: ({ args, command, status }) =>
      `${command} ${args.join(' ')} failed in ${cwd} with exit ${status}`,
  };
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

function javascriptOutputSize(outputDir, patterns = ['**/*.js']) {
  const filePaths = new Set(
    patterns.flatMap((pattern) =>
      globSync(pattern, {
        cwd: outputDir,
        nodir: true,
      }),
    ),
  );

  return Array.from(filePaths).reduce((totalBytes, filePath) => {
    return totalBytes + statSync(join(outputDir, filePath)).size;
  }, 0);
}

function runViteFixture(fixture) {
  const projectDir = copyFixture(fixture);
  try {
    console.log(`→ Running Vite fixture: ${fixture.name}`);
    run(
      process.execPath,
      [viteBin, 'build', '--config', viteConfig],
      fixtureRunOptions(projectDir),
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
      fixtureRunOptions(projectDir),
    );
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    assertExists(projectDir, fixture.assert);
    assertMatches(projectDir, fixture.match);
    assertContent(projectDir, fixture.assertContent);
    assertNoContent(projectDir, fixture.rejectContent);
    if (fixture.browserTest) {
      console.log(`  → Running browser assertions: ${fixture.name}`);
      run(
        process.execPath,
        [fixture.browserTest, outputDir],
        fixtureRunOptions(projectDir),
      );
      console.log(`  ✓ Browser assertions passed: ${fixture.name}`);
    }
    if (fixture.measure) {
      const outputSize = directorySize(outputDir);
      const jsBytes = javascriptOutputSize(outputDir);
      const measuredJsBytes = javascriptOutputSize(
        outputDir,
        fixture.javascriptMeasurePatterns,
      );
      if (
        Number.isFinite(fixture.maxMeasuredJavaScriptBytes) &&
        measuredJsBytes >= fixture.maxMeasuredJavaScriptBytes
      ) {
        throw new Error(
          `${fixture.name} emitted ${measuredJsBytes} measured JS bytes; expected less than ${fixture.maxMeasuredJavaScriptBytes}.`,
        );
      }
      console.log(
        `  Storybook metrics (${fixture.name}): ${(durationMs / 1000).toFixed(
          2,
        )}s, ${formatBytes(outputSize)} output, ${formatBytes(
          jsBytes,
        )} JS, ${formatBytes(measuredJsBytes)} measured JS${
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
