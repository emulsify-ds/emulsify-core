/**
 * @file Tests for the CSS asset reference audit check.
 */

import fs, { readFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveAssetRoots } from '../../../../config/vite/utils/asset-roots.js';
import { rewriteStylesheetUrls } from '../../../../config/vite/plugins/assets/asset-url-rebase.js';
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
const posixIt = process.platform === 'win32' ? it.skip : it;

describe('auditCssAssetReferences', () => {
  let projectDir;
  let externalDir;

  beforeEach(() => {
    projectDir = makeTempProject();
    externalDir = undefined;
    resetFileReadCache();
  });

  afterEach(() => {
    removeTempProject(projectDir);
    if (externalDir) removeTempProject(externalDir);
    jest.restoreAllMocks();
  });

  const audit = (styleFile, projectStructure = {}) => {
    const sourceRoots = projectStructure.sourceRoots || [
      join(projectDir, 'src'),
    ];

    return auditCssAssetReferences({
      env: {
        projectDir,
        projectStructure: { ...projectStructure, sourceRoots },
      },
      projectDir,
      sourceRoots,
      styleFiles: [styleFile],
    });
  };

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
        quote: '"',
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
        quote: '"',
        line: 3,
        start: 118,
        end: 135,
      },
    ]);
  });

  it.each([
    ['a block comment', '/* background: url("assets/images/hidden.svg"); */'],
    [
      'a trailing line comment',
      '.note { color: red; } // background: url("assets/images/hidden.svg");',
    ],
    [
      'a quoted string value',
      '.note::after { content: "url(assets/images/hidden.svg)"; }',
    ],
  ])(
    'ignores url() inside %s but still scans a URL token',
    (_, hiddenSource) => {
      writeFile(projectDir, 'assets/images/hidden.svg', '<svg />');
      writeFile(projectDir, 'assets/images/real.svg', '<svg />');
      const source = [
        hiddenSource,
        '.real { background: url("assets/images/real.svg"); }',
      ].join('\n');
      const styleFile = writeFile(
        projectDir,
        'src/components/card/card.scss',
        source,
      );

      expect(findCssUrlReferences(source).map(({ value }) => value)).toEqual([
        'assets/images/real.svg',
      ]);

      const findings = audit(styleFile);
      expect(findings).toHaveLength(1);
      expect(findings[0].fix).toMatchObject({
        original: 'assets/images/real.svg',
        replacement: '/assets/images/real.svg',
      });

      expect(applyAuditFixes(findings, { projectDir }).applied).toHaveLength(1);
      expect(readFileSync(styleFile, 'utf8')).toBe(
        [
          hiddenSource,
          '.real { background: url("/assets/images/real.svg"); }',
        ].join('\n'),
      );
    },
  );

  it.each([
    ['an unterminated string', '.bad { content: "unfinished'],
    [
      'an apostrophe in an unquoted URL',
      `.bad { background: url(assets/rock${QUOTE}n.svg); }`,
    ],
  ])('audits a URL on the line after %s', (_label, damagedLine) => {
    writeFile(projectDir, 'assets/images/real.svg', '<svg />');
    const realLine = '.real { background: Url("assets/images/real.svg"); }';
    const source = [damagedLine, realLine].join('\n');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      source,
    );

    expect(findCssUrlReferences(source).map(({ value }) => value)).toEqual([
      'assets/images/real.svg',
    ]);
    expect(audit(styleFile)).toEqual([
      expect.objectContaining({
        fix: expect.objectContaining({
          original: 'assets/images/real.svg',
          replacement: '/assets/images/real.svg',
        }),
      }),
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

  it('accepts an @assets alias that resolves', () => {
    writeFile(projectDir, 'assets/images/real.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("@assets/images/real.svg?v=2#icon"); }',
    );

    expect(audit(styleFile)).toEqual([]);
  });

  it('reports @assets when the Core asset resolver is disabled', () => {
    writeFile(projectDir, 'assets/images/real.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("@assets/images/real.svg"); }',
    );

    expect(audit(styleFile, { assetRebase: false })).toEqual([
      expect.objectContaining({
        id: 'unresolved-css-asset-reference',
        severity: 'warn',
        message: expect.stringContaining('assets.rebase is disabled'),
      }),
    ]);
  });

  it('accepts the documented Sass variable form of @assets', () => {
    writeFile(projectDir, 'assets/fonts/example/Avenir.woff2', 'font');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      [
        `$font-url: ${QUOTE}@assets/fonts/example${QUOTE};`,
        '@font-face {',
        `  src: url(${QUOTE}#{$font-url}/Avenir.woff2?v=2#regular${QUOTE});`,
        '}',
      ].join('\n'),
    );

    expect(audit(styleFile)).toEqual([]);
  });

  it('validates @assets against project roots instead of a same-named local directory', () => {
    writeFile(
      projectDir,
      'src/components/card/@assets/images/local.svg',
      '<svg />',
    );
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("@assets/images/local.svg"); }',
    );

    expect(audit(styleFile).map((finding) => finding.id)).toEqual([
      'unresolved-css-asset-reference',
    ]);
  });

  it('does not probe fix permissions when no URL needs a rewrite', () => {
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { color: rebeccapurple; }',
    );
    const accessSpy = jest.spyOn(fs, 'accessSync');

    expect(audit(styleFile)).toEqual([]);
    expect(accessSpy).not.toHaveBeenCalled();
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

  it('classifies a quoted dollar filename consistently in audit and build paths', () => {
    writeFile(projectDir, 'src/assets/images/logo$2x.svg', '<svg />');
    const source =
      '.dollar { background-image: url("assets/images/logo$2x.svg"); }';
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      source,
    );
    const roots = resolveAssetRoots({ projectDir });
    const beforeBuildPlans = [];

    expect(
      rewriteStylesheetUrls(source, styleFile, roots, (plan) =>
        beforeBuildPlans.push(plan.status),
      ),
    ).toEqual({
      code: source.replace(
        'assets/images/logo$2x.svg',
        '/assets/images/logo$2x.svg',
      ),
      changed: true,
    });
    expect(beforeBuildPlans).toEqual(['rebased']);

    const [finding] = audit(styleFile);
    expect(finding).toMatchObject({
      id: 'css-runtime-asset-reference',
      fix: {
        original: 'assets/images/logo$2x.svg',
        replacement: '/assets/images/logo$2x.svg',
      },
    });
    expect(applyAuditFixes([finding], { projectDir }).applied).toHaveLength(1);

    resetFileReadCache();
    const fixedSource = readFileSync(styleFile, 'utf8');
    const afterBuildPlans = [];
    expect(audit(styleFile)).toEqual([]);
    expect(
      rewriteStylesheetUrls(fixedSource, styleFile, roots, (plan) =>
        afterBuildPlans.push(plan.status),
      ),
    ).toEqual({ code: fixedSource, changed: false });
    expect(afterBuildPlans).toEqual(['publish']);
  });

  it('does not accept a directory with an asset filename as a local file', () => {
    fs.mkdirSync(
      join(projectDir, 'src/components/card/assets/images/bare.svg'),
      { recursive: true },
    );
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("assets/images/bare.svg"); }',
    );

    const [finding] = audit(styleFile);

    expect(finding.id).toBe('unresolved-css-asset-reference');
    expect(finding.fix).toBeUndefined();
  });

  it('does not offer --fix when a stylesheet resolves outside source roots', () => {
    writeFile(projectDir, 'assets/spinner.gif', 'ROOT');
    externalDir = makeTempProject();
    const externalStyle = writeFile(
      externalDir,
      'shared.scss',
      '.card { background-image: url("assets/spinner.gif"); }',
    );
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '',
    );
    unlinkSync(styleFile);
    symlinkSync(externalStyle, styleFile);

    const [finding] = audit(styleFile);

    expect(finding).toMatchObject({
      id: 'css-runtime-asset-reference',
      severity: 'info',
    });
    expect(finding.details).toContain(
      'Rewrite it as url(/assets/spinner.gif).',
    );
    expect(finding.fix).toBeUndefined();
    expect(finding.details.join('\n')).not.toContain('emulsify-audit --fix');
    expect(readFileSync(externalStyle, 'utf8')).toContain(
      'url("assets/spinner.gif")',
    );
  });

  it('does not offer --fix when the stylesheet directory is not writable', () => {
    writeFile(projectDir, 'assets/spinner.gif', 'ROOT');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background-image: url("assets/spinner.gif"); }',
    );
    const deniedPath = fs.realpathSync(dirname(styleFile));
    const originalAccess = fs.accessSync;
    jest.spyOn(fs, 'accessSync').mockImplementation((filePath, mode) => {
      if (
        filePath === deniedPath &&
        mode === (fs.constants.W_OK | fs.constants.X_OK)
      ) {
        throw Object.assign(new Error('simulated EACCES'), {
          code: 'EACCES',
        });
      }
      return originalAccess(filePath, mode);
    });

    const [finding] = audit(styleFile);

    expect(finding).toMatchObject({
      id: 'css-runtime-asset-reference',
      severity: 'info',
    });
    expect(finding.details).toContain(
      'Rewrite it as url(/assets/spinner.gif).',
    );
    expect(finding.fix).toBeUndefined();
    expect(finding.details.join('\n')).not.toContain('emulsify-audit --fix');
  });

  posixIt(
    'offers --fix for a read-only stylesheet in a writable directory',
    () => {
      writeFile(projectDir, 'assets/spinner.gif', 'ROOT');
      const styleFile = writeFile(
        projectDir,
        'src/components/card/card.scss',
        '.card { background-image: url("assets/spinner.gif"); }',
      );
      fs.chmodSync(styleFile, 0o444);

      const [finding] = audit(styleFile);

      expect(finding.fix).toEqual(
        expect.objectContaining({ replacement: '/assets/spinner.gif' }),
      );
      expect(finding.details.join('\n')).toContain('emulsify-audit --fix');
    },
  );

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
    expect(finding.details).toContain(
      'This URL contains Sass interpolation, so review its variable declaration instead of rewriting the reference automatically.',
    );
    expect(finding.details.join('\n')).not.toContain('Rewrite it as url(');
    expect(finding.details.join('\n')).not.toContain('emulsify-audit --fix');
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
