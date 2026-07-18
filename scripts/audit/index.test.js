/**
 * @file Integration tests for the combined audit orchestrator.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { formatAuditReport } from './report.js';
import { runAudits } from './index.js';
import { makeTempProject, removeTempProject, writeFile } from './test-utils.js';
import { runCli as runAuditCli, shouldFailAudit } from '../audit.js';

const require = createRequire(import.meta.url);
const corePackage = require('../../package.json');
const auditScript = join(process.cwd(), 'scripts/audit.js');

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
      'schemaVersion',
      'tool',
      'root',
      'summary',
      'files',
      'findings',
    ]);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.tool).toEqual({
      name: corePackage.name,
      version: corePackage.version,
    });
    expect(parsed.root).toBe('.');
    expect(parsed.summary).toEqual(summaryFromFindings(parsed.findings));
    expect(parsed.files).toEqual({
      stories: 1,
      twig: 1,
      code: 1,
      styles: 0,
    });
    expect(parsed.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'legacy-twig-story',
          severity: 'warn',
          path: 'src/components/card/card.stories.js',
          message: expect.any(String),
          details: expect.any(Array),
          docs: expect.any(String),
        }),
      ]),
    );
    expect(parsed.findings.some((finding) => 'filePath' in finding)).toBe(
      false,
    );
    expect(logSpy.mock.calls[0][0]).not.toContain(projectDir);
  });

  it('applies each fail-on threshold and keeps the default non-failing', () => {
    writeLegacyTwigStory();
    jest.spyOn(console, 'log').mockImplementation(() => {});

    expect(runAuditCli(['--root', projectDir])).toBe(0);
    expect(runAuditCli(['--root', projectDir, '--fail-on', 'error'])).toBe(0);
    expect(runAuditCli(['--root', projectDir, '--fail-on', 'warn'])).toBe(1);
    expect(runAuditCli(['--root', projectDir, '--fail-on', 'info'])).toBe(1);
    expect(runAuditCli(['--root', projectDir, '--fail-on', 'any'])).toBe(1);
    expect(
      runAuditCli(['--root', projectDir, '--json', '--fail-on-found']),
    ).toBe(1);

    removeTempProject(projectDir);
    projectDir = makeTempProject();
    writeConfiguredProject();

    expect(
      runAuditCli(['--root', projectDir, '--json', '--fail-on-found']),
    ).toBe(0);

    removeTempProject(projectDir);
    projectDir = makeTempProject();

    expect(runAuditCli(['--root', projectDir, '--fail-on', 'error'])).toBe(1);
  });

  it('treats info as the lowest threshold and normalizes unknown severities', () => {
    const findings = [
      { severity: 'error' },
      { severity: 'warn' },
      { severity: 'info' },
    ];

    expect(shouldFailAudit(findings, null)).toBe(false);
    expect(shouldFailAudit(findings, 'error')).toBe(true);
    expect(shouldFailAudit(findings.slice(1), 'error')).toBe(false);
    expect(shouldFailAudit(findings.slice(1), 'warn')).toBe(true);
    expect(shouldFailAudit(findings.slice(2), 'warn')).toBe(false);
    expect(shouldFailAudit(findings.slice(2), 'info')).toBe(true);
    expect(shouldFailAudit([{ severity: 'future' }], 'error')).toBe(false);
    expect(shouldFailAudit([{ severity: 'future' }], 'warn')).toBe(true);
    expect(shouldFailAudit([{ severity: 'future' }], 'info')).toBe(true);
    expect(shouldFailAudit([{ severity: 'future' }], 'any')).toBe(true);
    expect(shouldFailAudit([], 'any')).toBe(false);
  });

  it.each([
    [['--json', '--unknown'], 'Unknown option: --unknown'],
    [
      ['--json', '--fail-on'],
      '--fail-on requires one of: error, warn, info, any.',
    ],
    [
      ['--json', '--fail-on', 'fatal'],
      '--fail-on must be one of: error, warn, info, any.',
    ],
    [['--json', '--help'], '--json cannot be combined with --help.'],
  ])(
    'prints one structured JSON document for invalid arguments %#',
    (argv, message) => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      expect(runAuditCli(argv)).toBe(2);
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(JSON.parse(logSpy.mock.calls[0][0])).toEqual({
        schemaVersion: 1,
        tool: {
          name: corePackage.name,
          version: corePackage.version,
        },
        error: {
          code: 'invalid-arguments',
          message,
        },
      });
    },
  );

  it('retains useful usage output for invalid text-mode arguments', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(runAuditCli(['--unknown'])).toBe(2);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('Unknown option: --unknown');
    expect(errorSpy.mock.calls[0][0]).toContain('Usage: emulsify-audit');
  });

  it('keeps process stdout parseable for completed scans and CLI failures', () => {
    writeLegacyTwigStory();

    const completed = spawnSync(
      process.execPath,
      [auditScript, '--root', projectDir, '--json', '--fail-on', 'warn'],
      {
        encoding: 'utf8',
      },
    );

    expect(completed.status).toBe(1);
    expect(completed.stderr).toBe('');
    expect(JSON.parse(completed.stdout)).toMatchObject({
      schemaVersion: 1,
      root: '.',
      findings: [expect.objectContaining({ severity: 'warn' })],
    });

    const failed = spawnSync(
      process.execPath,
      [auditScript, '--json', '--unknown'],
      {
        encoding: 'utf8',
      },
    );

    expect(failed.status).toBe(2);
    expect(failed.stderr).toBe('');
    expect(JSON.parse(failed.stdout)).toMatchObject({
      schemaVersion: 1,
      error: {
        code: 'invalid-arguments',
      },
    });
  });
});
