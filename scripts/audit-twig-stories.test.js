/**
 * @file Tests for the Twig story migration audit.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analyzeStorySource,
  auditTwigStories,
  formatAuditReport,
  runCli as runTwigStoriesCli,
} from './audit-twig-stories.js';

describe('audit-twig-stories', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'emulsify-twig-audit-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  const writeLegacyStory = () => {
    const componentDir = join(projectDir, 'src/components/card');
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(
      join(componentDir, 'card.stories.js'),
      `
        import cardTwig from './card.twig';

        export const Card = (args) => cardTwig(args);
      `,
    );
  };

  it('reports legacy stories that return imported Twig templates directly', () => {
    const source = `
      import accordionTwig from './accordion.twig';

      export const Accordion = ({ heading }) =>
        accordionTwig({
          accordion__heading: heading,
        });
    `;

    const result = analyzeStorySource(source, 'accordion.stories.js');

    expect(result.shouldUpgrade).toBe(true);
    expect(result.twigImports).toEqual([
      {
        name: 'accordionTwig',
        specifier: './accordion.twig',
        line: 2,
      },
    ]);
    expect(result.directTemplateReturns).toEqual([
      {
        name: 'accordionTwig',
        line: 4,
      },
    ]);
    expect(result.reasons).toContain(
      'imports Twig templates without renderTwig()',
    );
  });

  it('does not report stories that already use renderTwig', () => {
    const source = `
      import template from './card.twig';
      import { renderTwig } from '@emulsify/core/storybook';

      export default {
        title: 'Components/Card',
        render: renderTwig(template),
      };

      export const Default = {};
    `;

    expect(analyzeStorySource(source).shouldUpgrade).toBe(false);
  });

  it('scans project story roots and formats a readable report', () => {
    writeLegacyStory();

    const result = auditTwigStories({ projectDir });
    const report = formatAuditReport(result);

    expect(result.findings).toHaveLength(1);
    expect(report).toContain('src/components/card/card.stories.js');
    expect(report).toContain('cardTwig() appears to be returned directly');
  });

  it('prints a machine-readable JSON report', () => {
    writeLegacyStory();
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const exitCode = runTwigStoriesCli(['--root', projectDir, '--json']);

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
    expect(parsed.summary).toEqual({
      error: 0,
      warn: parsed.findings.length,
      info: 0,
    });
    expect(parsed.findings).toEqual([
      expect.objectContaining({
        filePath: expect.stringContaining('card.stories.js'),
        twigImports: expect.any(Array),
        directTemplateReturns: expect.any(Array),
        reasons: expect.any(Array),
        shouldUpgrade: true,
      }),
    ]);
  });

  it('preserves fail-on-found exit semantics for JSON output', () => {
    writeLegacyStory();
    jest.spyOn(console, 'log').mockImplementation(() => {});

    expect(
      runTwigStoriesCli(['--root', projectDir, '--json', '--fail-on-found']),
    ).toBe(1);

    rmSync(projectDir, { recursive: true, force: true });
    projectDir = mkdtempSync(join(tmpdir(), 'emulsify-twig-audit-'));

    expect(
      runTwigStoriesCli(['--root', projectDir, '--json', '--fail-on-found']),
    ).toBe(0);
  });
});
