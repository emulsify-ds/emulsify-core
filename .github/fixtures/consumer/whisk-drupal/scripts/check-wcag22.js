/**
 * Prove the optional preset through the tarball's actual accessibility command.
 * The synthetic pages isolate rule selection from Storybook build behavior.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import wcag22 from '@emulsify/core/a11y/wcag22';

const coreRoot = dirname(
  fileURLToPath(import.meta.resolve('@emulsify/core/package.json')),
);
const coreScript = join(coreRoot, 'scripts/a11y.js');
const { default: defaults } = await import(
  pathToFileURL(join(coreRoot, 'config/a11y.config.js')).href
);
assert.equal(defaults.pa11y.rules, undefined);
// Nest the temporary project under the consumer so package imports still
// resolve to its installed tarball, without symlinks or source-checkout paths.
const projectDir = mkdtempSync(join(process.cwd(), '.wcag22-'));
const buildDir = join(projectDir, '.out');
const configDir = join(projectDir, 'config/emulsify-core');
const results = [];

assert.ok(wcag22.pa11y.rules.includes('target-size'));

try {
  mkdirSync(buildDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(projectDir, 'package.json'), '{"type":"module"}\n');

  for (const { name, size, preset, status } of [
    { name: 'default-small', size: 10, preset: false, status: 0 },
    { name: 'preset-small', size: 10, preset: true, status: 1 },
    { name: 'preset-corrected', size: 24, preset: true, status: 0 },
    { name: 'default-after-preset', size: 10, preset: false, status: 0 },
  ]) {
    writeFileSync(
      join(buildDir, 'iframe.html'),
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>WCAG 2.2 target size fixture</title>
    <style>
      .targets { display: flex; gap: 0; }
      button { width: ${size}px; height: ${size}px; padding: 0; border: 0; }
    </style>
  </head>
  <body>
    <main id="storybook-root">
      <h1>Target size fixture</h1>
      <div class="targets">
        <button aria-label="Previous item"></button>
        <button aria-label="Next item"></button>
      </div>
    </main>
  </body>
</html>`,
    );
    const presetImport = preset
      ? `import wcag22 from ${JSON.stringify('@emulsify/core/a11y/wcag22')};\n`
      : '';
    writeFileSync(
      join(configDir, 'a11y.config.js'),
      `${presetImport}
export default {
  components: ['${name}'],
  discoverStories: false,
  storybookBuildDir: '.out',
  pa11y: {
    ${preset ? '...wcag22.pa11y,' : ''}
    chromeLaunchConfig: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  },
};\n`,
    );

    const result = spawnSync(process.execPath, [coreScript, '-r'], {
      cwd: projectDir,
      encoding: 'utf8',
      timeout: 60_000,
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert.ifError(result.error);
    assert.equal(result.status, status, `${name}: ${output}`);
    if (preset && size === 10) {
      assert.match(output, /target-size/u, output);
      assert.match(output, /severity: error/u, output);
    } else {
      assert.match(output, /No issues found in component:/u, output);
      assert.doesNotMatch(output, /target-size/u, output);
    }
    results.push({ name, size, preset, status: result.status });
  }
  console.log(JSON.stringify({ preset: wcag22, results }, null, 2));
} finally {
  rmSync(projectDir, { force: true, recursive: true });
}
