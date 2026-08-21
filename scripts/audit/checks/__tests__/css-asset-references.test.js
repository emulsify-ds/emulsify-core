/**
 * @file Tests for the CSS asset reference audit check.
 */

import { readFileSync } from 'node:fs';

import { auditCssAssetReferences } from '../css-asset-references.js';
import { applyAuditFixes } from '../../fix.js';
import { resetFileReadCache } from '../../lib/files.js';
import { findCssUrlReferences } from '../../lib/css.js';
import {
  makeTempProject,
  removeTempProject,
  writeFile,
} from '../../test-utils.js';

// The lint rule bans double-quoted strings, and these fixtures need a literal
// single quote to exercise CSS quote handling.
const QUOTE = String.fromCharCode(39);

describe('auditCssAssetReferences', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
    resetFileReadCache();
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  const audit = (styleFile, projectStructure = {}) =>
    auditCssAssetReferences({
      env: { projectDir, projectStructure },
      projectDir,
      styleFiles: [styleFile],
    });

  const expectLocalReferenceUntouched = (styleFile) => {
    const before = readFileSync(styleFile, 'utf8');
    const findings = audit(styleFile);

    expect(findings.filter(({ severity }) => severity !== 'info')).toEqual([]);
    expect(findings.every(({ fix }) => fix === undefined)).toBe(true);

    const result = applyAuditFixes(findings, { projectDir });
    expect(result.applied).toEqual([]);
    expect(readFileSync(styleFile, 'utf8')).toBe(before);
  };

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
        start: 59,
        end: 84,
      },
    ]);
  });

  it('reports offsets that slice the authored specifier back out', () => {
    // The autofix splices by byte range, so this invariant is what keeps it
    // from corrupting a file. Comment masking must not shift positions.
    const source = [
      '/* background: url("../icons/blocked.svg"); */',
      `.real { background: url(${QUOTE}../icons/real.svg${QUOTE}); }`,
    ].join('\n');

    for (const ref of findCssUrlReferences(source)) {
      expect(source.slice(ref.start, ref.end)).toBe(ref.raw);
    }
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
        start: 118,
        end: 135,
      },
    ]);
  });

  it('validates the canonical /assets/ form', () => {
    // The headline gap: every absolute URL used to be skipped outright, so a
    // typo in the documented convention was caught by nothing at all.
    writeFile(projectDir, 'assets/images/real.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("/assets/images/typoo.svg"); }',
    );

    expect(audit(styleFile).map((finding) => finding.id)).toEqual([
      'unresolved-css-asset-reference',
    ]);
  });

  it('accepts a canonical URL that resolves', () => {
    writeFile(projectDir, 'assets/images/real.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("/assets/images/real.svg"); }',
    );

    expect(audit(styleFile)).toEqual([]);
  });

  it('leaves platform-served absolute URLs alone', () => {
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      [
        '.a { background: url("/sites/default/files/x.png"); }',
        '.b { background: url("/themes/custom/foo/y.png"); }',
      ].join('\n'),
    );

    expect(audit(styleFile)).toEqual([]);
  });

  it('skips URLs whose interpolation never expanded', () => {
    // `#{...}` used to be checked only at position 0, which stopped mattering
    // as soon as absolute URLs started being validated.
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("/assets/icons/#{$name}.svg"); }',
    );

    expect(audit(styleFile)).toEqual([]);
  });

  it('leaves a bare assets/ URL that resolves beside the stylesheet untouched', () => {
    writeFile(projectDir, 'src/components/card/assets/spinner.gif', 'LOCAL');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("assets/spinner.gif"); }',
    );

    expectLocalReferenceUntouched(styleFile);
  });

  it('keeps a local asset when a project-root twin has the same tail', () => {
    writeFile(projectDir, 'src/components/card/assets/spinner.gif', 'LOCAL');
    writeFile(projectDir, 'assets/spinner.gif', 'ROOT');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("assets/spinner.gif"); }',
    );

    expectLocalReferenceUntouched(styleFile);
  });

  it('still validates canonical URLs only against project asset roots', () => {
    writeFile(projectDir, 'src/components/card/assets/spinner.gif', 'LOCAL');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("/assets/spinner.gif"); }',
    );

    const [finding] = audit(styleFile);

    expect(finding.id).toBe('unresolved-css-asset-reference');
    expect(finding.severity).toBe('warn');
    expect(finding.fix).toBeUndefined();
  });

  it('offers the canonical rewrite for a root-only bare assets/ URL', () => {
    // Documented in docs/asset-references.md, but Vite reads it as a package
    // specifier, so the build has to repair it.
    writeFile(projectDir, 'assets/spinner.gif', 'ROOT');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("assets/spinner.gif"); }',
    );

    const [finding] = audit(styleFile);

    expect(finding.id).toBe('css-runtime-asset-reference');
    expect(finding.severity).toBe('info');
    expect(finding.details).toContain(
      'Rewrite it as url(/assets/spinner.gif).',
    );
    expect(finding.fix).toMatchObject({
      original: 'assets/spinner.gif',
      replacement: '/assets/spinner.gif',
    });

    const result = applyAuditFixes([finding], { projectDir });
    expect(result.applied).toHaveLength(1);
    expect(readFileSync(styleFile, 'utf8')).toBe(
      '.card { background-image: url("/assets/spinner.gif"); }',
    );
  });

  it('offers the canonical rewrite for a wrong-depth relative URL', () => {
    // The reported bug: this depth is correct from mirrored Drupal SDC output
    // and wrong everywhere else.
    writeFile(projectDir, 'assets/images/hero.jpg', 'jpg');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("../../assets/images/hero.jpg"); }',
    );

    const [finding] = audit(styleFile);

    expect(finding.id).toBe('css-runtime-asset-reference');
    expect(finding.fix.replacement).toBe('/assets/images/hero.jpg');
  });

  it('resolves configured asset roots the way Storybook serves them', () => {
    writeFile(projectDir, 'custom-assets/icons/brand.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/search/search.scss',
      '.brand { mask-image: url("/assets/icons/brand.svg"); }',
    );

    expect(audit(styleFile, { assetRoots: ['custom-assets'] })).toEqual([]);
  });

  it('refuses to suggest a rewrite it cannot pick', () => {
    writeFile(projectDir, 'assets/icons/dupe.svg', '<svg />');
    writeFile(projectDir, 'src/assets/icons/dupe.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/search/search.scss',
      '.dupe { mask-image: url("assets/icons/dupe.svg"); }',
    );

    const [finding] = audit(styleFile);

    expect(finding.id).toBe('unresolved-css-asset-reference');
    expect(finding.fix).toBeUndefined();
    expect(finding.message).toContain('more than one project asset root');
  });

  it('never offers to rewrite an interpolated URL', () => {
    // The edit belongs on the $font-url declaration, and same-file variable
    // scanning cannot see who else depends on it.
    writeFile(projectDir, 'assets/fonts/Avenir.woff2', 'font');
    const styleFile = writeFile(
      projectDir,
      'src/foundation/typography/_fonts.scss',
      [
        '$font-url: "../../../../assets/fonts";',
        '@font-face { src: url("#{$font-url}/Avenir.woff2"); }',
      ].join('\n'),
    );

    const [finding] = audit(styleFile);

    expect(finding.id).toBe('css-runtime-asset-reference');
    expect(finding.fix).toBeUndefined();
  });

  it('reports unresolved CSS asset references', () => {
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("./missing.svg"); }',
    );

    const [finding] = audit(styleFile);

    expect(finding.id).toBe('unresolved-css-asset-reference');
    expect(finding.details.join(' ')).toContain('url(/assets/...)');
  });
});
