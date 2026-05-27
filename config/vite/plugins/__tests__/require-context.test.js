/**
 * @file Tests for Webpack require.context compatibility.
 */

import {
  requireContextCompatPlugin,
  transformRequireContext,
} from '../require-context.js';

describe('require.context compatibility plugin', () => {
  const quote = String.fromCharCode(39);

  it('rewrites static recursive asset contexts to eager Vite globs', () => {
    const result = transformRequireContext(
      [
        `const svgIcons = require.context(${quote}../../../assets/icons/${quote}, true, /\\.svg$/);`,
        'const icons = svgIcons.keys();',
      ].join('\n'),
    );

    expect(result).toContain('const __emulsifyRequireContext =');
    expect(result).toContain(
      'import.meta.glob("../../../assets/icons/**/*.svg", { eager: true, import: \'default\' })',
    );
    expect(result).toContain('new RegExp("\\\\.svg$", "")');
    expect(result).not.toContain('require.context');
  });

  it('rewrites multiline contexts with grouped extensions', () => {
    const result = transformRequireContext(
      [
        'const assets = require.context(',
        `  ${quote}./media${quote},`,
        '  false,',
        '  /\\.(svg|png)$/i,',
        ');',
      ].join('\n'),
    );

    expect(result).toContain(
      'import.meta.glob("./media/*.{svg,png}", { eager: true, import: \'default\' })',
    );
    expect(result).toContain('"./media/"');
    expect(result).toContain('new RegExp("\\\\.(svg|png)$", "i")');
  });

  it('preserves require.context-style keys for matched modules', () => {
    const result = transformRequireContext(
      `const svgIcons = require.context(${quote}../../../assets/icons/${quote}, true, /\\.svg$/);`,
    );
    const helper = result.split('const svgIcons =')[0];
    const context = new Function(
      `${helper}
       return __emulsifyRequireContext(
         {
           '../../../assets/icons/alert.svg': 'alert-url',
           '../../../assets/icons/nested/check.svg': 'check-url',
           '../../../assets/icons/readme.md': 'ignored'
         },
         '../../../assets/icons/',
         new RegExp('\\\\.svg$', '')
       );`,
    )();

    expect(context.keys()).toEqual(['./alert.svg', './nested/check.svg']);
    expect(context('./alert.svg')).toBe('alert-url');
    expect(context.resolve('./nested/check.svg')).toBe(
      '../../../assets/icons/nested/check.svg',
    );
  });

  it('ignores modules without static require.context calls', () => {
    const plugin = requireContextCompatPlugin();

    expect(
      plugin.transform('const value = 1;', '/project/story.js'),
    ).toBeNull();
    expect(
      plugin.transform(
        'const context = require.context(path, true, /\\.svg$/);',
        '/project/story.js',
      ),
    ).toBeNull();
    expect(
      plugin.transform(
        `const icons = require.context(${quote}./icons${quote}, true, /\\.svg$/);`,
        '/project/node_modules/pkg/story.js',
      ),
    ).toBeNull();
  });
});
