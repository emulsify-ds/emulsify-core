/**
 * @file Tests for CSS minifier syntax error reporting.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import {
  createAssetResolver,
  extractSourceTokens,
  findLikelySource,
} from '../reporter/asset-resolver.js';
import {
  classifyBuildError,
  parseCssSyntaxError,
} from '../reporter/build-errors.js';
import { createDiagnosticsCollector } from '../reporter/diagnostics.js';
import { createStyler } from '../reporter/format.js';
import { renderSummary } from '../reporter/render.js';

const plain = createStyler(false);

// The frame Vite's generateCodeFrame produced for the reported failure.
const FRAME = [
  '9328 |    margin: 0;',
  '9329 |  }',
  '9330 |  @media (min-width: 60.9375rem, max-width: 75rem) {',
  '     |                               ^',
  '9331 |    .page-hero h1 {',
  '9332 |      font-size: 2.8125rem;',
].join('\n');

/**
 * Build the error Vite throws when lightningcss rejects the bundle.
 *
 * Vite tags the message, rebases the column to zero, and attaches the frame.
 *
 * @param {object} [overrides] - Property overrides.
 * @returns {Error} Minifier error.
 */
const lightningcssError = (overrides = {}) =>
  Object.assign(
    new SyntaxError('[lightningcss minify] Unexpected token Comma'),
    {
      plugin: 'vite:css-post',
      loc: { line: 9330, column: 30 },
      frame: FRAME,
      ...overrides,
    },
  );

describe('css syntax error parsing', () => {
  it('reads the minifier, message, bundle line, and offending rule', () => {
    expect(parseCssSyntaxError(lightningcssError())).toEqual({
      minifier: 'lightningcss minify',
      message: 'Unexpected token Comma',
      bundleLine: 9330,
      declaration: '@media (min-width: 60.9375rem, max-width: 75rem) {',
      caretColumn: 29,
    });
  });

  it('places the caret under the offending character', () => {
    const { declaration, caretColumn } =
      parseCssSyntaxError(lightningcssError());

    // The caret must land on the comma that lightningcss rejected.
    expect(declaration[caretColumn]).toBe(',');
  });

  it('recognizes the esbuild minifier too', () => {
    const parsed = parseCssSyntaxError(
      lightningcssError({
        message: '[esbuild css minify] Unexpected ")"',
      }),
    );

    expect(parsed.minifier).toBe('esbuild css minify');
    expect(parsed.message).toBe('Unexpected ")"');
  });

  it('falls back to the caret row when there is no bundle line', () => {
    const parsed = parseCssSyntaxError(lightningcssError({ loc: undefined }));

    expect(parsed.bundleLine).toBeUndefined();
    expect(parsed.declaration).toBe(
      '@media (min-width: 60.9375rem, max-width: 75rem) {',
    );
  });

  it('survives an error with no frame at all', () => {
    const parsed = parseCssSyntaxError(
      lightningcssError({ frame: undefined, loc: undefined }),
    );

    expect(parsed).toMatchObject({
      minifier: 'lightningcss minify',
      declaration: undefined,
      caretColumn: undefined,
    });
  });

  it('ignores errors that are not minifier failures', () => {
    expect(parseCssSyntaxError(new Error('Undefined mixin.'))).toBeUndefined();
    expect(parseCssSyntaxError(undefined)).toBeUndefined();
  });

  it('classifies a minifier failure apart from imports and other errors', () => {
    const { importErrors, syntaxErrors, otherErrors } =
      classifyBuildError(lightningcssError());

    expect(syntaxErrors).toHaveLength(1);
    expect(importErrors).toHaveLength(0);
    expect(otherErrors).toHaveLength(0);
  });
});

describe('source token extraction', () => {
  it('ranks precise decimals ahead of everything else', () => {
    const tokens = extractSourceTokens(
      '@media (min-width: 60.9375rem, max-width: 75rem) {',
    );

    // A value like 60.9375rem is nearly always authored verbatim.
    expect(tokens[0]).toBe('60.9375rem');
    expect(tokens).toContain('75rem');
  });

  it('prefers hyphenated names over bare css keywords', () => {
    const tokens = extractSourceTokens('.page-hero h1 { font-size: 2rem; }');

    expect(tokens).toContain('page-hero');
    // `font` and `size` alone locate nothing useful.
    expect(tokens).not.toContain('font');
  });

  it('picks up hex colors', () => {
    expect(extractSourceTokens('color: #8B1E7E;')).toContain('#8B1E7E');
  });

  it('deduplicates repeated literals', () => {
    const tokens = extractSourceTokens('margin: 2rem 2rem 2rem 2rem;');
    expect(tokens.filter((token) => token === '2rem')).toHaveLength(1);
  });

  it('returns nothing for a rule with no distinctive content', () => {
    expect(extractSourceTokens('}')).toEqual([]);
    expect(extractSourceTokens(undefined)).toEqual([]);
  });
});

describe('likely source lookup', () => {
  let projectDir;

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
      projectDir = undefined;
    }
  });

  /**
   * Write stylesheets and return a resolver over them.
   *
   * @param {Record<string, string>} files - Path to contents.
   * @returns {ReturnType<createAssetResolver>} Resolver.
   */
  const withProject = (files) => {
    projectDir = mkdtempSync(join(tmpdir(), 'emulsify-syntax-'));

    for (const [relativePath, contents] of Object.entries(files)) {
      const absolutePath = join(projectDir, relativePath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, contents);
    }

    return createAssetResolver({ projectDir });
  };

  it('traces a generated rule back to the scss that defines its value', () => {
    const resolver = withProject({
      'src/components/base/global/_breakpoints.scss': [
        '$breakpoints: (',
        '  large: (min-width: 60.9375rem, max-width: 75rem),',
        ');',
      ].join('\n'),
      'src/components/atoms/_buttons.scss': '.btn { color: red; }',
    });

    const lead = findLikelySource(
      '@media (min-width: 60.9375rem, max-width: 75rem) {',
      resolver,
    );

    expect(lead.token).toBe('60.9375rem');
    expect(lead.matches).toEqual([
      { file: 'global/_breakpoints.scss', line: 2, text: expect.any(String) },
    ]);
  });

  it('skips a token that appears in too many files to be a lead', () => {
    const files = {};
    for (let index = 0; index < 9; index += 1) {
      files[`src/c${index}/_c${index}.scss`] = '.a { margin: 1rem; }';
    }
    files['src/only/_only.scss'] = '.b { width: 33.3333rem; }';

    const lead = findLikelySource(
      'margin: 1rem; width: 33.3333rem;',
      withProject(files),
    );

    // `1rem` is everywhere; the precise decimal is the actual lead.
    expect(lead.token).toBe('33.3333rem');
  });

  it('reports nothing when no literal survives into the source', () => {
    const resolver = withProject({ 'src/a/_a.scss': '.a { color: red; }' });

    expect(
      findLikelySource('@media (min-width: 99.5rem) {', resolver),
    ).toBeUndefined();
  });

  it('reports nothing for a rule with no literals', () => {
    const resolver = withProject({ 'src/a/_a.scss': '.a { color: red; }' });

    expect(findLikelySource('}', resolver)).toBeUndefined();
  });
});

describe('syntax error rendering', () => {
  /**
   * Render a summary containing the given syntax errors.
   *
   * @param {Array<object>} syntaxErrors - Parsed syntax errors.
   * @returns {string} Rendered output.
   */
  const render = (syntaxErrors) =>
    renderSummary({
      snapshot: createDiagnosticsCollector().snapshot(),
      durationMs: 2400,
      projectDir: '/p',
      syntaxErrors,
      styler: plain,
    }).join('\n');

  const parsed = {
    minifier: 'lightningcss minify',
    message: 'Unexpected token Comma',
    bundleLine: 9330,
    declaration: '@media (min-width: 60.9375rem, max-width: 75rem) {',
    caretColumn: 29,
  };

  it('shows the minifier, message, rule, and caret', () => {
    const output = render([parsed]).split('\n');

    expect(output.join('\n')).toContain('✗ 1 css syntax error');
    expect(output.join('\n')).toContain(
      'lightningcss minify  Unexpected token Comma',
    );

    const rule = output.find((line) => line.includes('@media'));
    const caret = output.find((line) => line.trim() === '^');

    // The caret column must line up with the comma in the rule above it.
    expect(caret.indexOf('^')).toBe(rule.indexOf(','));
  });

  it('labels the bundle line as generated output', () => {
    // A bare 9330 reads like a source location, which it is not.
    expect(render([parsed])).toContain('bundle line 9330');
  });

  it('mentions the verbose escape hatch', () => {
    expect(render([parsed])).toContain('EMULSIFY_VERBOSE=1');
  });

  it('lists likely sources when a lead was found', () => {
    const output = render([
      {
        ...parsed,
        lead: {
          token: '60.9375rem',
          matches: [{ file: 'global/_breakpoints.scss', line: 12 }],
        },
      },
    ]);

    expect(output).toContain('likely source');
    expect(output).toContain('global/_breakpoints.scss:12');
    expect(output).toContain('60.9375rem');
  });

  it('degrades to the rule alone when nothing was found', () => {
    const output = render([parsed]);

    expect(output).not.toContain('likely source');
    expect(output).toContain('@media (min-width: 60.9375rem');
  });

  it('marks the build as failed', () => {
    expect(render([parsed])).toContain('✗ build failed after 2.40s');
  });

  it('says nothing when there is no syntax error', () => {
    expect(render([])).not.toContain('css syntax error');
  });
});

describe('syntax error collection', () => {
  it('collapses the same broken rule reported twice', () => {
    const collector = createDiagnosticsCollector();
    const entry = {
      minifier: 'lightningcss minify',
      message: 'Unexpected token Comma',
      declaration: '@media (min-width: 60.9375rem, max-width: 75rem) {',
    };

    collector.recordSyntaxError(entry);
    collector.recordSyntaxError({ ...entry });

    const snapshot = collector.snapshot();
    expect(snapshot.syntaxErrors).toHaveLength(1);
    expect(snapshot.syntaxErrors[0].count).toBe(2);
    expect(snapshot.hasProblems).toBe(true);
    expect(collector.hasCapturedBuildErrors()).toBe(true);
  });

  it('clears syntax errors on reset', () => {
    const collector = createDiagnosticsCollector();
    collector.recordSyntaxError({ message: 'boom' });
    collector.reset();

    expect(collector.hasCapturedBuildErrors()).toBe(false);
  });
});
