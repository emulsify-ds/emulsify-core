/**
 * @file Integration tests for the combined audit orchestrator.
 */

import { formatAuditReport } from './report.js';
import { runAudits } from './index.js';
import { makeTempProject, removeTempProject, writeFile } from './test-utils.js';
import { runCli as runAuditCli } from '../audit.js';

describe('audit orchestrator', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
  });

  afterEach(() => {
    removeTempProject(projectDir);
    jest.restoreAllMocks();
  });

  const writeConfiguredProject = () => {
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
  };

  const writeLegacyTwigStory = () => {
    writeConfiguredProject();
    writeFile(
      projectDir,
      'src/components/card/card.twig',
      '<p>{{ title }}</p>',
    );
    writeFile(
      projectDir,
      'src/components/card/card.stories.js',
      [
        'import cardTwig from "./card.twig";',
        'export const Card = (args) => cardTwig(args);',
      ].join('\n'),
    );
  };

  const summaryFromFindings = (findings) =>
    findings.reduce(
      (summary, finding) => ({
        ...summary,
        [finding.severity]: summary[finding.severity] + 1,
      }),
      {
        error: 0,
        warn: 0,
        info: 0,
      },
    );

  it('runs all checks and formats a stable report', () => {
    writeConfiguredProject();
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

  it('prints a machine-readable JSON report', () => {
    writeLegacyTwigStory();
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const exitCode = runAuditCli(['--root', projectDir, '--json']);

    expect(exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);

    const parsed = JSON.parse(logSpy.mock.calls[0][0]);

    expect(Object.keys(parsed)).toEqual([
      'version',
      'projectDir',
      'summary',
      'findings',
    ]);
    expect(parsed.version).toEqual(expect.any(String));
    expect(parsed.projectDir).toBe(projectDir);
    expect(parsed.summary).toEqual(summaryFromFindings(parsed.findings));
    expect(parsed.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'legacy-twig-story',
          severity: 'warn',
          filePath: expect.stringContaining('card.stories.js'),
          message: expect.any(String),
          details: expect.any(Array),
          docs: expect.any(String),
        }),
      ]),
    );
  });

  it('preserves fail-on-found exit semantics for JSON output', () => {
    writeLegacyTwigStory();
    jest.spyOn(console, 'log').mockImplementation(() => {});

    expect(
      runAuditCli(['--root', projectDir, '--json', '--fail-on-found']),
    ).toBe(1);

    removeTempProject(projectDir);
    projectDir = makeTempProject();
    writeConfiguredProject();

    expect(
      runAuditCli(['--root', projectDir, '--json', '--fail-on-found']),
    ).toBe(0);
  });
});
