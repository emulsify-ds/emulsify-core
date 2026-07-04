/**
 * @file Tests for the CSS asset reference audit check.
 */

import { auditCssAssetReferences } from '../css-asset-references.js';
import { resetFileReadCache } from '../../lib/files.js';
import { findCssUrlReferences } from '../../lib/css.js';
import {
  makeTempProject,
  removeTempProject,
  writeFile,
} from '../../test-utils.js';

describe('auditCssAssetReferences', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
    resetFileReadCache();
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  it('expands simple Sass variables in CSS URL references', () => {
    expect(
      findCssUrlReferences(
        [
          '$font-url: "../../../assets/fonts";',
          '@font-face { src: url("#{$font-url}/Avenir.woff2"); }',
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
    writeFile(projectDir, 'assets/fonts/Avenir.woff2', 'font');
    const styleFile = writeFile(
      projectDir,
      'src/foundation/typography/_fonts.scss',
      [
        '$font-url: "../../../assets/fonts";',
        '@font-face { src: url("#{$font-url}/Avenir.woff2"); }',
      ].join('\n'),
    );

    const findings = auditCssAssetReferences({
      env: {
        projectDir,
        projectStructure: {},
      },
      projectDir,
      styleFiles: [styleFile],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('css-runtime-asset-reference');
  });

  it('reports CSS runtime references from src/assets and configured asset roots', () => {
    writeFile(projectDir, 'src/assets/icons/search.svg', '<svg />');
    writeFile(projectDir, 'custom-assets/icons/brand.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/search/search.scss',
      [
        '.search { mask-image: url("../../assets/icons/search.svg"); }',
        '.brand { mask-image: url("../../../custom-assets/icons/brand.svg"); }',
      ].join('\n'),
    );

    const findings = auditCssAssetReferences({
      env: {
        projectDir,
        projectStructure: {
          assetRoots: ['custom-assets'],
        },
      },
      projectDir,
      styleFiles: [styleFile],
    });

    expect(findings.map((finding) => finding.message)).toEqual([
      'CSS asset URL "../../assets/icons/search.svg" resolves to project-level assets and may be left unchanged by Vite for runtime resolution.',
      'CSS asset URL "../../../custom-assets/icons/brand.svg" resolves to project-level assets and may be left unchanged by Vite for runtime resolution.',
    ]);
  });

  it('reports unresolved CSS asset references', () => {
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("./missing.svg"); }',
    );

    const findings = auditCssAssetReferences({
      env: {
        projectDir,
        projectStructure: {},
      },
      projectDir,
      styleFiles: [styleFile],
    });

    expect(findings.map((finding) => finding.id)).toContain(
      'unresolved-css-asset-reference',
    );
  });
});
