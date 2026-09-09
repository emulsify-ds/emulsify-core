/**
 * @file Verify JSON stdout and exit statuses through an installed theme wrapper.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wrappers = {
  audit: {
    failArgs: ['--fail-on', 'warn'],
    footer:
      'Audit docs: https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/migration-4x.md#storybook-migration',
  },
  'audit:twig-stories': {
    failArgs: ['--fail-on-found'],
    footer:
      'Migration docs: https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/storybook.md#legacy-twig-story-compatibility',
  },
};

/**
 * Exercise the actual packed audit through the consumer's copied npm script.
 * A separate source root gives both calls the same known migration warning.
 *
 * @param {string} projectDir - Installed consumer fixture directory.
 * @param {string} scriptName - Copied audit script to verify.
 * @returns {void}
 */
export function verifyCopiedAuditWrapper(projectDir, scriptName = 'audit') {
  assert.ok(Object.hasOwn(wrappers, scriptName), 'Unknown audit wrapper.');
  const { failArgs, footer } = wrappers[scriptName];
  const auditRoot = mkdtempSync(
    join(tmpdir(), 'emulsify audit "wrapper" root-'),
  );
  const storyPath = 'src/components/card/card.stories.js';

  try {
    const componentDir = join(auditRoot, 'src/components/card');
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(
      join(auditRoot, 'project.emulsify.json'),
      JSON.stringify({ project: { platform: 'none' } }),
    );
    writeFileSync(join(componentDir, 'card.twig'), '<p>{{ title }}</p>');
    writeFileSync(
      join(auditRoot, storyPath),
      'import cardTwig from "./card.twig";\nexport const Card = (args) => cardTwig(args);\n',
    );

    for (const failOnWarn of [false, true]) {
      const result = spawnSync(
        'npm',
        [
          'run',
          '--silent',
          scriptName,
          '--',
          '--root',
          auditRoot,
          '--json',
          ...(failOnWarn ? failArgs : []),
        ],
        {
          cwd: projectDir,
          encoding: 'utf8',
          env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
        },
      );

      assert.ifError(result.error);
      assert.equal(
        result.status,
        failOnWarn ? 1 : 0,
        `Copied ${scriptName} wrapper returned an incorrect exit status: ${result.stderr}`,
      );
      // Parse the entire stream: stripping a footer or selecting a JSON line
      // would hide exactly the copied-wrapper regression this fixture covers.
      const report = JSON.parse(result.stdout);
      assert.equal(report.schemaVersion, 1);
      assert.equal(report.tool.name, '@emulsify/core');
      assert.equal(report.files.stories, 1);
      assert.deepEqual(report.summary, { error: 0, warn: 1, info: 0 });
      assert.deepEqual(
        report.findings.map(({ id, severity, path }) => ({
          id,
          severity,
          path,
        })),
        [{ id: 'legacy-twig-story', severity: 'warn', path: storyPath }],
        'Expected only the controlled legacy story warning from the selected root.',
      );
      assert.ok(
        result.stderr.split(/\r?\n/).includes(footer),
        `Copied ${scriptName} wrapper omitted its expected stderr footer.`,
      );
    }

    console.log(
      `  ✓ Copied ${scriptName} wrapper: JSON stdout, stderr footer, quoted root, exits 0/1`,
    );
  } finally {
    rmSync(auditRoot, { recursive: true, force: true });
  }
}
