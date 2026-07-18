#!/usr/bin/env node
/**
 * @file Verify public package imports from an installed tarball.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { run } from './lib/proc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '..');

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

{
  const core = await import('@emulsify/core');
  const storybook = await import('@emulsify/core/storybook');
  const twig = await import('@emulsify/core/extensions/twig');
  const react = await import('@emulsify/core/extensions/react');
  const vite = await import('@emulsify/core/vite');
  const plugins = await import('@emulsify/core/vite/plugins');
  const platforms = await import('@emulsify/core/vite/platforms');

  if (!core.react || !core.twig) {
    throw new Error('extension namespaces missing from @emulsify/core');
  }
  if (!vite.default) {
    throw new Error('default export missing from @emulsify/core/vite');
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
    twig,
    'registerTwigExtensions',
    '@emulsify/core/extensions/twig',
  );
  assertFunction(plugins, 'makePlugins', '@emulsify/core/vite/plugins');
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
}
`;

async function main() {
  const [pack] = JSON.parse(run('npm', ['pack', '--json'], runOptions));
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
  run(process.execPath, ['--input-type=module', '--eval', smokeScript], {
    ...runOptions,
    cwd: tempDir,
    stdio: 'inherit',
  });

  console.log('Public package imports resolved successfully.');
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
