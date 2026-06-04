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
} from './audit-twig-stories.js';

describe('audit-twig-stories', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'emulsify-twig-audit-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

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
    const componentDir = join(projectDir, 'src/components/card');
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(
      join(componentDir, 'card.stories.js'),
      `
        import cardTwig from './card.twig';

        export const Card = (args) => cardTwig(args);
      `,
    );

    const result = auditTwigStories({ projectDir });
    const report = formatAuditReport(result);

    expect(result.findings).toHaveLength(1);
    expect(report).toContain('src/components/card/card.stories.js');
    expect(report).toContain('cardTwig() appears to be returned directly');
  });
});
