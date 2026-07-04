#!/usr/bin/env node
/**
 * @file Verify public package imports from an installed tarball.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '..');

let tempDir;
let tarballPath;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: packageRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  });
}

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

  assertFunction(storybook, 'renderTwig', '@emulsify/core/storybook');
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
  const [pack] = JSON.parse(run('npm', ['pack', '--json']));
  tarballPath = isAbsolute(pack.filename)
    ? pack.filename
    : join(packageRoot, pack.filename);
  tempDir = mkdtempSync(join(tmpdir(), 'emulsify-core-pack-'));

  run('npm', ['init', '-y'], { cwd: tempDir, stdio: 'ignore' });
  run('npm', ['install', tarballPath], { cwd: tempDir, stdio: 'inherit' });
  execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', smokeScript],
    { cwd: tempDir, stdio: 'inherit' },
  );

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
