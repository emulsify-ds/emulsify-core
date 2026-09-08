/**
 * @file Verify JSON stdout and exit statuses through an installed theme wrapper.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Exercise the actual packed audit through the consumer's copied npm script.
 * A separate source root gives both calls the same known migration warning.
 *
 * @param {string} projectDir - Installed consumer fixture directory.
 * @returns {void}
 */
export function verifyCopiedAuditWrapper(projectDir) {
  const auditRoot = mkdtempSync(join(tmpdir(), 'emulsify-audit-wrapper-'));

  try {
    const componentDir = join(auditRoot, 'src/components/card');
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(
      join(auditRoot, 'project.emulsify.json'),
      JSON.stringify({ project: { platform: 'none' } }),
    );
    writeFileSync(join(componentDir, 'card.twig'), '<p>{{ title }}</p>');
    writeFileSync(
      join(componentDir, 'card.stories.js'),
      'import cardTwig from "./card.twig";\nexport const Card = (args) => cardTwig(args);\n',
    );

    for (const failOnWarn of [false, true]) {
      const result = spawnSync(
        'npm',
        [
          'run',
          '--silent',
          'audit',
          '--',
          '--root',
          auditRoot,
          '--json',
          ...(failOnWarn ? ['--fail-on', 'warn'] : []),
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
        `Copied audit wrapper returned an incorrect exit status: ${result.stderr}`,
      );
      // Parse the entire stream: stripping a footer or selecting a JSON line
      // would hide exactly the copied-wrapper regression this fixture covers.
      const report = JSON.parse(result.stdout);
      assert.equal(report.schemaVersion, 1);
      assert.equal(report.tool.name, '@emulsify/core');
      assert.ok(
        report.findings.some(
          ({ id, severity }) =>
            id === 'legacy-twig-story' && severity === 'warn',
        ),
        'Expected the known legacy story warning in the packed audit report.',
      );
      assert.match(result.stderr, /Audit docs: https:\/\/github\.com\//);
    }

    console.log(
      '  ✓ Copied audit wrapper: JSON stdout, stderr footer, exits 0/1',
    );
  } finally {
    rmSync(auditRoot, { recursive: true, force: true });
  }
}
