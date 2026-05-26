/**
 * @file Tests for the combined Emulsify audit.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  auditProject,
  findCssUrlReferences,
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
    expect(report).not.toContain('stories/outside.stories.js');
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

  it('reports missing recommended package overrides for Core consumers', () => {
    writeFile(
      projectDir,
      'project.emulsify.json',
      JSON.stringify({
        project: {
          platform: 'generic',
        },
      }),
    );
    writeFile(
      projectDir,
      'package.json',
      JSON.stringify({
        name: 'consumer-theme',
        dependencies: {
          '@emulsify/core': '^4.0.0',
        },
      }),
    );

    const result = auditProject({ projectDir });
    const finding = result.findings.find(
      (item) => item.id === 'recommended-package-overrides-missing',
    );

    expect(finding.details).toEqual([
      'Add overrides.glob: ^13.0.6.',
      'Add overrides.locutus: ^3.0.36.',
      'Add overrides.minimatch@3.0.x: ^3.1.5.',
    ]);
  });

  it('accepts recommended package overrides for Core consumers', () => {
    writeFile(
      projectDir,
      'project.emulsify.json',
      JSON.stringify({
        project: {
          platform: 'generic',
        },
      }),
    );
    writeFile(
      projectDir,
      'package.json',
      JSON.stringify({
        name: 'consumer-theme',
        dependencies: {
          '@emulsify/core': '^4.0.0',
        },
        overrides: {
          glob: '^13.0.6',
          locutus: '^3.0.36',
          'minimatch@3.0.x': '^3.1.5',
        },
      }),
    );

    const result = auditProject({ projectDir });

    expect(result.findings.map((finding) => finding.id)).not.toContain(
      'recommended-package-overrides-missing',
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

  it('expands simple Sass variables in CSS URL references', () => {
    const quote = String.fromCharCode(39);

    expect(
      findCssUrlReferences(
        [
          '$font-url: ' + quote + '../../../assets/fonts' + quote + ';',
          '@font-face { src: url(' +
            quote +
            '#{$font-url}/Avenir.woff2' +
            quote +
            '); }',
        ].join('\n'),
      ),
    ).toEqual([
      {
        value: '../../../assets/fonts/Avenir.woff2',
        raw: '#{$font-url}/Avenir.woff2',
        line: 2,
      },
    ]);
  });

  it('ignores CSS URL references in comments', () => {
    expect(
      findCssUrlReferences(
        [
          '// mask-image: url("../icons/commented.svg");',
          '/* background: url("../icons/blocked.svg"); */',
          '.real { background: url("../icons/real.svg"); }',
        ].join('\n'),
      ),
    ).toEqual([
      {
        value: '../icons/real.svg',
        raw: '../icons/real.svg',
        line: 3,
      },
    ]);
  });

  it('reports CSS asset references that rely on runtime project assets', () => {
    const quote = String.fromCharCode(39);

    writeFile(
      projectDir,
      'project.emulsify.json',
      JSON.stringify({
        project: {
          platform: 'drupal',
          singleDirectoryComponents: true,
        },
      }),
    );
    writeFile(projectDir, 'assets/fonts/Avenir.woff2', 'font');
    writeFile(projectDir, 'assets/icons/search.svg', '<svg />');
    writeFile(
      projectDir,
      'src/foundation/typography/_fonts.scss',
      [
        '$font-url: ' + quote + '../../../assets/fonts' + quote + ';',
        '@font-face { src: url(' +
          quote +
          '#{$font-url}/Avenir.woff2' +
          quote +
          '); }',
      ].join('\n'),
    );
    writeFile(
      projectDir,
      'src/components/search/search.scss',
      '.search { mask-image: url("../../assets/icons/search.svg"); }',
    );

    const result = auditProject({ projectDir });
    const findings = result.findings.filter(
      (finding) => finding.id === 'css-runtime-asset-reference',
    );

    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.filePath)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('src/foundation/typography/_fonts.scss'),
        expect.stringContaining('src/components/search/search.scss'),
      ]),
    );
  });

  it('reports unresolved CSS asset references', () => {
    writeFile(
      projectDir,
      'project.emulsify.json',
      JSON.stringify({
        project: {
          platform: 'generic',
        },
      }),
    );
    writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("./missing.svg"); }',
    );

    const result = auditProject({ projectDir });

    expect(result.findings.map((finding) => finding.id)).toContain(
      'unresolved-css-asset-reference',
    );
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

  it('scans canonical source roots instead of generated components or Drupal templates', () => {
    writeFile(
      projectDir,
      'project.emulsify.json',
      JSON.stringify({
        project: {
          platform: 'drupal',
          singleDirectoryComponents: true,
        },
      }),
    );
    writeFile(
      projectDir,
      'src/components/card/card.twig',
      '{{ include("@missing/source.twig") }}',
    );
    writeFile(
      projectDir,
      'components/card/card.twig',
      '{{ include("@missing/generated.twig") }}',
    );
    writeFile(
      projectDir,
      'templates/layout/page.html.twig',
      '{{ include("@missing/template.twig") }}',
    );

    const result = auditProject({ projectDir });
    const unresolved = result.findings.filter(
      (finding) => finding.id === 'unresolved-twig-reference',
    );

    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].message).toContain('@missing/source.twig');
    expect(result.files.twig).toBe(1);
  });
});
