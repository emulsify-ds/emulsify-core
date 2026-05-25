/**
 * @file Tests for the combined Emulsify audit.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  auditProject,
  findTwigIncludeSourceReferences,
  formatAuditReport,
} from './audit.js';

function writeFile(projectDir, relPath, contents = '') {
  const filePath = join(projectDir, relPath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
  return filePath;
}

describe('audit', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'emulsify-audit-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('reports combined readiness findings', () => {
    writeFile(
      projectDir,
      'project.emulsify.json',
      JSON.stringify({
        project: {
          platform: 'generic',
          name: 'Audit fixture',
          machineName: 'audit_fixture',
        },
      }),
    );
    writeFile(
      projectDir,
      'src/components/card/card.twig',
      `
        {{ include('@components/card/_content.twig', { label: 'OK' }) }}
        {{ include('@missing/card.twig') }}
      `,
    );
    writeFile(
      projectDir,
      'src/components/card/_content.twig',
      '<p>{{ label }}</p>',
    );
    writeFile(
      projectDir,
      'src/components/card/card.stories.js',
      `
        import cardTwig from './card.twig';
        import { renderTwig } from '@emulsify/core/src/storybook/render-twig.js';
        require.context('./', true, /stories/);
        window.Drupal.attachBehaviors();
        export const Card = (args) => cardTwig(args);
      `,
    );
    writeFile(
      projectDir,
      'stories/outside.stories.js',
      'export const Outside = {};',
    );

    const result = auditProject({ projectDir, twigThreshold: 1 });
    const ids = result.findings.map((finding) => finding.id);
    const report = formatAuditReport(result);

    expect(ids).toEqual(
      expect.arrayContaining([
        'story-outside-discovered-roots',
        'legacy-twig-story',
        'unknown-twig-namespace',
        'unresolved-twig-reference',
        'webpack-era-pattern',
        'internal-core-import',
        'drupal-assumption-non-drupal',
        'large-twig-storybook-roots',
      ]),
    );
    expect(report).toContain('Emulsify project audit');
    expect(report).toContain('stories/outside.stories.js');
  });

  it('reports missing project config and missing configured roots', () => {
    writeFile(
      projectDir,
      'project.emulsify.json',
      JSON.stringify({
        project: {
          platform: 'generic',
        },
        variant: {
          structureImplementations: [
            {
              name: 'components',
              directory: './missing-components',
            },
          ],
        },
      }),
    );

    const result = auditProject({ projectDir });

    expect(result.findings.map((finding) => finding.id)).toContain(
      'missing-structure-implementation',
    );
  });

  it('only treats first include/source argument strings as template references', () => {
    const quote = String.fromCharCode(39);

    expect(
      findTwigIncludeSourceReferences(
        `{{ include(${quote}@components/card/card.twig${quote}, { label: ${quote}Not a template${quote} }) }}`,
      ),
    ).toEqual([
      {
        type: 'include',
        value: '@components/card/card.twig',
        line: 1,
      },
    ]);
  });

  it('does not report conventional template override files as component source roots', () => {
    writeFile(
      projectDir,
      'project.emulsify.json',
      JSON.stringify({
        project: {
          platform: 'drupal',
        },
      }),
    );
    writeFile(projectDir, 'templates/layout/page.html.twig', '<main></main>');

    const result = auditProject({ projectDir });

    expect(result.findings.map((finding) => finding.id)).not.toContain(
      'twig-file-outside-source-roots',
    );
  });
});
