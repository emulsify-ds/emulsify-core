/**
 * @file Integration tests for the combined audit orchestrator.
 */

import { formatAuditReport } from './report.js';
import { runAudits } from './index.js';
import { makeTempProject, removeTempProject, writeFile } from './test-utils.js';

describe('audit orchestrator', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  it('runs all checks and formats a stable report', () => {
    writeFile(
      projectDir,
      'project.emulsify.json',
      JSON.stringify({
        project: {
          platform: 'none',
          name: 'Audit fixture',
          machineName: 'audit_fixture',
        },
      }),
    );
    writeFile(
      projectDir,
      'src/components/card/card.twig',
      [
        '{{ include("@components/card/_content.twig", { label: "OK" }) }}',
        '{{ include("@missing/card.twig") }}',
      ].join('\n'),
    );
    writeFile(
      projectDir,
      'src/components/card/_content.twig',
      '<p>{{ label }}</p>',
    );
    writeFile(
      projectDir,
      'src/components/card/card.stories.js',
      [
        'import cardTwig from "./card.twig";',
        'import { renderTwig } from "@emulsify/core/src/storybook/render-twig.js";',
        'require.context("./", true, /stories/);',
        'window.Drupal.attachBehaviors();',
        'export const Card = (args) => cardTwig(args);',
      ].join('\n'),
    );
    writeFile(
      projectDir,
      'stories/outside.stories.js',
      'export const Outside = {};',
    );

    const result = runAudits({ projectDir, twigThreshold: 1 });
    const ids = result.findings.map((finding) => finding.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        'legacy-twig-story',
        'unknown-twig-namespace',
        'unresolved-twig-reference',
        'webpack-era-pattern',
        'internal-core-import',
        'drupal-assumption-non-drupal',
        'large-twig-storybook-roots',
      ]),
    );
    expect(
      formatAuditReport(result).replaceAll(projectDir, '<projectDir>'),
    ).toMatchSnapshot();
  });
});
