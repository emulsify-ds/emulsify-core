#!/usr/bin/env node
/**
 * @file Verify public package imports from an installed tarball.
 */

import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { run } from './lib/proc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '..');
const mixedStorybookFixture = join(
  packageRoot,
  '.github/fixtures/release/mixed-storybook',
);
const expectedStoryIds = [
  'fixtures-mixed-storybook--twig-card',
  'fixtures-mixed-storybook-custom-element--custom-element-card',
];

let tempDir;
let tarballPath;

const runOptions = {
  cwd: packageRoot,
  mode: 'exec',
  stdio: ['ignore', 'pipe', 'inherit'],
};

const smokeScript = `
function assertFunction(module, exportName, specifier) {
  if (typeof module[exportName] !== 'function') {
    throw new Error(exportName + ' missing from ' + specifier);
  }
}

async function assertPackagePathNotExported(specifier) {
  try {
    await import(specifier);
  } catch (error) {
    if (error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return;
    throw error;
  }

  throw new Error('Internal package path unexpectedly resolved: ' + specifier);
}

{
  const core = await import('@emulsify/core');
  const extensions = await import('@emulsify/core/extensions');
  const storybook = await import('@emulsify/core/storybook');
  const twig = await import('@emulsify/core/extensions/twig');
  const react = await import('@emulsify/core/extensions/react');
  const includeFunction = await import(
    '@emulsify/core/storybook/twig/include-function'
  );
  const drupalFilters = await import(
    '@emulsify/core/storybook/twig/drupal-filters'
  );
  const vite = await import('@emulsify/core/vite');
  const plugins = await import('@emulsify/core/vite/plugins');
  const platforms = await import('@emulsify/core/vite/platforms');

  if (!core.react || !core.twig) {
    throw new Error('extension namespaces missing from @emulsify/core');
  }
  if (!extensions.react || !extensions.twig) {
    throw new Error(
      'extension namespaces missing from @emulsify/core/extensions',
    );
  }
  if (!vite.default) {
    throw new Error('default export missing from @emulsify/core/vite');
  }
  if (!drupalFilters.default) {
    throw new Error(
      'default export missing from @emulsify/core/storybook/twig/drupal-filters',
    );
  }

  assertFunction(
    storybook,
    'defineCustomElement',
    '@emulsify/core/storybook',
  );
  assertFunction(storybook, 'renderTwig', '@emulsify/core/storybook');
  assertFunction(
    storybook,
    'renderWebComponent',
    '@emulsify/core/storybook',
  );
  assertFunction(
    storybook,
    'getActiveStorybookAdapter',
    '@emulsify/core/storybook',
  );
  assertFunction(
    storybook,
    'renderHtmlStoryResult',
    '@emulsify/core/storybook',
  );
  assertFunction(
    storybook,
    'renderTwigHtml',
    '@emulsify/core/storybook',
  );
  assertFunction(
    storybook,
    'renderTwigToHtml',
    '@emulsify/core/storybook',
  );
  assertFunction(
    storybook,
    'TwigHtmlStory',
    '@emulsify/core/storybook',
  );
  assertFunction(storybook, 'TwigStory', '@emulsify/core/storybook');
  assertFunction(
    twig,
    'getTwigFunctionMap',
    '@emulsify/core/extensions/twig',
  );
  assertFunction(
    twig,
    'registerTwigExtensions',
    '@emulsify/core/extensions/twig',
  );
  assertFunction(
    twig,
    'addAttributes',
    '@emulsify/core/extensions/twig',
  );
  assertFunction(
    twig,
    'addAttributesTwigFunction',
    '@emulsify/core/extensions/twig',
  );
  assertFunction(
    twig,
    'bemAttributes',
    '@emulsify/core/extensions/twig',
  );
  assertFunction(
    twig,
    'bemTwigFunction',
    '@emulsify/core/extensions/twig',
  );
  assertFunction(
    react,
    'defineReactExtension',
    '@emulsify/core/extensions/react',
  );
  assertFunction(
    includeFunction,
    'createTwigIncludeFunction',
    '@emulsify/core/storybook/twig/include-function',
  );
  assertFunction(plugins, 'makePlugins', '@emulsify/core/vite/plugins');
  assertFunction(
    plugins,
    'makeTwigNamespaces',
    '@emulsify/core/vite/plugins',
  );
  assertFunction(
    plugins,
    'makeTwigPluginOptions',
    '@emulsify/core/vite/plugins',
  );
  assertFunction(
    platforms,
    'getPlatformAdapter',
    '@emulsify/core/vite/platforms',
  );
  assertFunction(
    platforms,
    'normalizePlatformName',
    '@emulsify/core/vite/platforms',
  );
  assertFunction(
    react,
    'createReactExtensionRegistry',
    '@emulsify/core/extensions/react',
  );
  if (!platforms.adapters || typeof platforms.adapters !== 'object') {
    throw new Error('adapters missing from @emulsify/core/vite/platforms');
  }

  await assertPackagePathNotExported(
    '@emulsify/core/storybook/twig/asset-source-runtime',
  );
}
`;

function assertInstalledPackageIsExtracted(installedPackageRoot) {
  const relativeToSource = relative(
    realpathSync(packageRoot),
    realpathSync(installedPackageRoot),
  );

  if (
    relativeToSource === '' ||
    (!relativeToSource.startsWith('..') && !isAbsolute(relativeToSource))
  ) {
    throw new Error(
      `Packed package resolved into the source checkout: ${installedPackageRoot}`,
    );
  }
}

function copyMixedStorybookFixture(projectDir) {
  cpSync(
    join(mixedStorybookFixture, 'project.emulsify.json'),
    join(projectDir, 'project.emulsify.json'),
  );
  cpSync(join(mixedStorybookFixture, 'src'), join(projectDir, 'src'), {
    recursive: true,
  });
  cpSync(join(mixedStorybookFixture, 'assets'), join(projectDir, 'assets'), {
    recursive: true,
  });
}

function assertAuditCli() {
  const auditBin = join(tempDir, 'node_modules/.bin/emulsify-audit');
  const auditOutput = run(auditBin, ['--json', '--root', tempDir], {
    ...runOptions,
    cwd: tempDir,
  });
  const report = JSON.parse(auditOutput);

  if (report.schemaVersion !== 1 || report.tool?.name !== '@emulsify/core') {
    throw new Error('Installed emulsify-audit returned an invalid JSON report');
  }
}

function assertEmulsifyCli() {
  const cliBin = join(tempDir, 'node_modules/.bin/emulsify');
  const installedCliRoot = join(tempDir, 'node_modules/@emulsify/cli');

  if (!existsSync(cliBin)) {
    throw new Error('Packed Core install did not provide the emulsify binary');
  }

  const resolvedBin = realpathSync(cliBin);
  const relativeToInstalledCli = relative(
    realpathSync(installedCliRoot),
    resolvedBin,
  );
  if (
    relativeToInstalledCli.startsWith('..') ||
    isAbsolute(relativeToInstalledCli)
  ) {
    throw new Error(
      `Installed emulsify binary resolved outside @emulsify/cli: ${resolvedBin}`,
    );
  }

  const helpOutput = run('npx', ['--no-install', 'emulsify', '--help'], {
    ...runOptions,
    cwd: tempDir,
  });
  if (!helpOutput.includes('Emulsify CLI')) {
    throw new Error(
      'Installed emulsify --help output did not identify Emulsify CLI',
    );
  }
}

function buildPackedStorybook(installedPackageRoot) {
  const outputDir = join(tempDir, '.out');
  const storybookBin = join(tempDir, 'node_modules/.bin/storybook');
  const storybookConfigDir = join(installedPackageRoot, '.storybook');

  run(
    storybookBin,
    ['build', '--config-dir', storybookConfigDir, '-o', outputDir],
    {
      ...runOptions,
      cwd: tempDir,
      echoOutputOnFailure: true,
      env: {
        ...process.env,
        CI: '1',
        FORCE_COLOR: '0',
        NODE_OPTIONS: '--no-deprecation',
      },
      failureMessage: 'Packed Storybook consumer build failed.',
      mode: 'spawn',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const storyIndex = JSON.parse(
    readFileSync(join(outputDir, 'index.json'), 'utf8'),
  );
  for (const storyId of expectedStoryIds) {
    if (!storyIndex.entries?.[storyId]) {
      throw new Error(`Packed Storybook output is missing story ${storyId}`);
    }
  }
}

async function main() {
  const [pack] = JSON.parse(
    run('npm', ['pack', '--ignore-scripts', '--json'], runOptions),
  );
  tarballPath = isAbsolute(pack.filename)
    ? pack.filename
    : join(packageRoot, pack.filename);
  tempDir = mkdtempSync(join(tmpdir(), 'emulsify-core-pack-'));

  run('npm', ['init', '-y'], {
    ...runOptions,
    cwd: tempDir,
    stdio: 'ignore',
  });
  run('npm', ['install', tarballPath], {
    ...runOptions,
    cwd: tempDir,
    stdio: 'inherit',
  });
  const installedPackageRoot = join(tempDir, 'node_modules/@emulsify/core');
  assertInstalledPackageIsExtracted(installedPackageRoot);
  copyMixedStorybookFixture(tempDir);

  run(process.execPath, ['--input-type=module', '--eval', smokeScript], {
    ...runOptions,
    cwd: tempDir,
    stdio: 'inherit',
  });
  assertAuditCli();
  assertEmulsifyCli();
  buildPackedStorybook(installedPackageRoot);

  console.log(
    'Packed package imports, Core audit CLIs, Emulsify CLI, and Storybook consumer build passed.',
  );
}

try {
  await main();
} finally {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  if (tarballPath && existsSync(tarballPath)) {
    rmSync(tarballPath, { force: true });
  }
}
