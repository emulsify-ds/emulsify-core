/**
 * @file CSF export selection and inherited render paths in the Twig audit.
 */

import { execFileSync } from 'node:child_process';
import { analyzeStorySource } from '../../../audit-twig-stories.js';
import {
  findRenderTwigBindings,
  findTwigTemplateBindings,
  parseStoryModule,
} from '../story-ast.js';
import { classifyStoryRenderPaths } from '../story-render-paths.js';

const imports = [
  'import cardTwig from "./card.twig";',
  'import { renderTwig } from "@emulsify/core/storybook";',
];

const analyze = (lines, filePath = 'card.stories.js') =>
  analyzeStorySource([...imports, ...lines].join('\n'), filePath);

const classify = (source) => {
  const { ast } = parseStoryModule(source, 'card.stories.js');

  return classifyStoryRenderPaths(ast, {
    templateNames: findTwigTemplateBindings(ast).map(({ name }) => name),
    renderTwigNames: findRenderTwigBindings(ast),
  });
};

const expectLegacyLines = (result, lines) => {
  expect(result).toMatchObject({
    shouldUpgrade: lines.length > 0,
    directTemplateReturns: lines.map((line) => ({ name: 'cardTwig', line })),
  });
};

describe('CSF story export selection', () => {
  it.each(['lowercase', 'Uppercase'])(
    'selects a legacy export named %s without casing heuristics',
    (name) => {
      expectLegacyLines(
        analyze([`export const ${name} = (args) => cardTwig(args);`]),
        [3],
      );
    },
  );

  it.each(['lowerAlias', 'UpperAlias'])(
    'applies includeStories to the exported alias %s',
    (name) => {
      expectLegacyLines(
        analyze([
          'const localRenderer = (args) => cardTwig(args);',
          `export default { includeStories: ["${name}"] };`,
          `export { localRenderer as ${name} };`,
        ]),
        [3],
      );
    },
  );

  it('excludes an aliased export by its exported name', () => {
    expectLegacyLines(
      analyze([
        'const localRenderer = (args) => cardTwig(args);',
        'export default { excludeStories: ["VisibleAlias"] };',
        'export { localRenderer as VisibleAlias };',
      ]),
      [],
    );
  });

  it.each([
    ['no filters', '', [4, 5, 6]],
    ['include list', 'includeStories: ["lower"]', [4]],
    ['exclude list', 'excludeStories: ["Upper"]', [4, 6]],
    [
      'exclusion wins when both lists match',
      'includeStories: ["lower", "Upper"], excludeStories: ["Upper"]',
      [4],
    ],
    ['empty include list', 'includeStories: []', []],
    ['empty exclude list', 'excludeStories: []', [4, 5, 6]],
    ['explicit __esModule include', 'includeStories: ["__esModule"]', []],
    [
      'explicit __namedExportsOrder include',
      'includeStories: ["__namedExportsOrder"]',
      [],
    ],
  ])('honors %s', (description, filters, expectedLines) => {
    expectLegacyLines(
      analyze([
        `export default { ${filters} };`,
        'export const lower = (args) => cardTwig(args);',
        'export const Upper = (args) => cardTwig(args);',
        'export const helper = (args) => cardTwig(args);',
        'export const __esModule = (args) => cardTwig(args);',
        'export const __namedExportsOrder = (args) => cardTwig(args);',
      ]),
      expectedLines,
    );
  });

  it.each(['', 'g', 'y'])(
    'applies an include regex with flags "%s" independently to each export',
    (flags) => {
      expectLegacyLines(
        analyze([
          `export default { includeStories: /^story/${flags} };`,
          'export const storyOne = (args) => cardTwig(args);',
          'export const storyTwo = (args) => cardTwig(args);',
          'export const helper = (args) => cardTwig(args);',
        ]),
        [4, 5],
      );
    },
  );

  it('combines include and exclude regex literals', () => {
    expectLegacyLines(
      analyze([
        'export default { includeStories: /^story/g, excludeStories: /Two$/ };',
        'export const storyOne = (args) => cardTwig(args);',
        'export const storyTwo = (args) => cardTwig(args);',
        'export const helper = (args) => cardTwig(args);',
      ]),
      [4],
    );
  });

  it('applies an exclude regex independently to each matching export', () => {
    expectLegacyLines(
      analyze([
        'export default { excludeStories: /^story/g };',
        'export const storyOne = (args) => cardTwig(args);',
        'export const storyTwo = (args) => cardTwig(args);',
        'export const helper = (args) => cardTwig(args);',
      ]),
      [6],
    );
  });

  it('matches installed Storybook selection for supported static filters', () => {
    const names = [
      'lower',
      'Upper',
      'storyOne',
      'storyTwo',
      'helper',
      '__esModule',
    ];
    const cases = [
      { source: '' },
      { source: 'includeStories: []', include: [] },
      {
        source: 'includeStories: ["lower", "Upper"]',
        include: ['lower', 'Upper'],
      },
      { source: 'excludeStories: ["Upper"]', exclude: ['Upper'] },
      {
        source: 'includeStories: ["lower", "Upper"], excludeStories: ["Upper"]',
        include: ['lower', 'Upper'],
        exclude: ['Upper'],
      },
      {
        source: 'includeStories: /^story/g',
        include: { pattern: '^story', flags: 'g' },
      },
      {
        source: 'includeStories: /^story/y',
        include: { pattern: '^story', flags: 'y' },
      },
      {
        source: 'includeStories: /^story/, excludeStories: /Two$/',
        include: { pattern: '^story', flags: '' },
        exclude: { pattern: 'Two$', flags: '' },
      },
    ];

    // Load Storybook's declared ESM export in Node, outside Jest transforms.
    // Fresh regexes keep each name independent, including sticky expressions.
    const expected = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `import { isExportStory } from 'storybook/internal/csf';
          const names = ${JSON.stringify(names)};
          const cases = ${JSON.stringify(cases)};
          const filter = value => !value || Array.isArray(value)
            ? value ?? undefined
            : new RegExp(value.pattern, value.flags);
          process.stdout.write(JSON.stringify(cases.map(item =>
            names.filter(name => Boolean(isExportStory(name, {
              includeStories: filter(item.include),
              excludeStories: filter(item.exclude),
            })))
          )));`,
        ],
        { encoding: 'utf8' },
      ),
    );

    for (const [index, { source }] of cases.entries()) {
      const result = analyze([
        `export default { ${source} };`,
        ...names.map(
          (name) => `export const ${name} = (args) => cardTwig(args);`,
        ),
      ]);

      expect(
        result.directTemplateReturns.map(({ line }) => names[line - 4]),
      ).toEqual(expected[index]);
    }
  });

  it('inherits an inline default render for a selected empty story object', () => {
    expectLegacyLines(
      analyze([
        'export default { includeStories: ["lower"], render: (args) => cardTwig(args) };',
        'export const lower = {};',
      ]),
      [3],
    );
  });

  it('resolves default metadata through module aliases', () => {
    expectLegacyLines(
      analyze([
        'const metadata = { includeStories: ["lower"], render: (args) => cardTwig(args) };',
        'const exportedMetadata = metadata;',
        'export default exportedMetadata;',
        'export const lower = {};',
      ]),
      [3],
    );
  });

  it('resolves a story object member before inheriting the default render', () => {
    expectLegacyLines(
      analyze([
        'export default { render: (args) => cardTwig(args) };',
        'const definitions = { primary: {} };',
        'export const primary = definitions.primary;',
      ]),
      [3],
    );
  });

  it('applies filters and inherited renders through a static metadata member', () => {
    expectLegacyLines(
      analyze([
        'const definitions = { meta: { includeStories: ["primary"], render: (args) => cardTwig(args) } };',
        'export default definitions.meta;',
        'export const primary = {};',
        'export const Helper = (args) => cardTwig(args);',
      ]),
      [3],
    );
  });

  it('uses only the render of an aliased story object, ignoring docs callbacks', () => {
    expectLegacyLines(
      analyze([
        'const definitions = { primary: { render: renderTwig(cardTwig), parameters: { docs: { source: () => cardTwig({}) } } } };',
        'export const primary = definitions.primary;',
      ]),
      [],
    );
  });

  it.each(['metadata satisfies Meta', 'metadata as Meta', 'metadata!'])(
    'unwraps TypeScript default metadata: %s',
    (expression) => {
      expectLegacyLines(
        analyze(
          [
            'const metadata = { includeStories: ["lower"], render: (args: object) => cardTwig(args) };',
            `export default ${expression};`,
            'export const lower = {};',
          ],
          'card.stories.ts',
        ),
        [3],
      );
    },
  );

  it.each([
    [
      'modern object render',
      'export const Story = { render: renderTwig(cardTwig) };',
      [],
    ],
    ['plain function story', 'export const Story = () => "plain HTML";', []],
    [
      'legacy function story',
      'export const Story = (args) => cardTwig(args);',
      [4],
    ],
  ])(
    'overrides the inherited render with a %s',
    (description, story, lines) => {
      expectLegacyLines(
        analyze([
          'export default { render: (args) => cardTwig(args) };',
          story,
        ]),
        lines,
      );
    },
  );

  it('reports a story override even when the default render is modern', () => {
    expectLegacyLines(
      analyze([
        'export default { render: renderTwig(cardTwig) };',
        'export const Story = { render: (args) => cardTwig(args) };',
      ]),
      [4],
    );
  });

  it.each(['null', 'undefined', '0', '""', 'false'])(
    'inherits the default render when a story render is %s',
    (render) => {
      expectLegacyLines(
        analyze([
          'export default { render: (args) => cardTwig(args) };',
          `export const Story = { render: ${render} };`,
        ]),
        [3],
      );
    },
  );

  it.each([
    ['no named exports', '', []],
    [
      'excluded named export',
      'includeStories: [],',
      ['export const Story = {};'],
    ],
    ['only __esModule', '', ['export const __esModule = {};']],
    [
      'only __namedExportsOrder',
      '',
      ['export const __namedExportsOrder = {};'],
    ],
  ])(
    'does not audit an unused default render with %s',
    (description, filters, stories) => {
      expectLegacyLines(
        analyze([
          `export default { ${filters} render: (args) => cardTwig(args) };`,
          ...stories,
        ]),
        [],
      );
    },
  );

  describe('unevaluated metadata', () => {
    afterEach(() => {
      delete globalThis.__emulsifyStorySelectionExecuted;
    });

    it.each(['includeStories', 'excludeStories'])(
      'conservatively retains legacy exports for dynamic %s',
      (field) => {
        const result = analyze([
          'const selectStories = () => { globalThis.__emulsifyStorySelectionExecuted = true; return []; };',
          `export default { ${field}: selectStories() };`,
          'export const Legacy = (args) => cardTwig(args);',
        ]);

        expectLegacyLines(result, [5]);
        expect(globalThis.__emulsifyStorySelectionExecuted).toBeUndefined();
      },
    );

    it('does not execute a metadata factory to discover filters', () => {
      const result = analyze([
        'const createMetadata = () => { globalThis.__emulsifyStorySelectionExecuted = true; return { includeStories: [] }; };',
        'export default createMetadata();',
        'export const Legacy = (args) => cardTwig(args);',
      ]);

      expectLegacyLines(result, [5]);
      expect(globalThis.__emulsifyStorySelectionExecuted).toBeUndefined();
    });

    it('does not invoke a metadata getter to discover filters', () => {
      const result = analyze([
        'export default { get includeStories() { globalThis.__emulsifyStorySelectionExecuted = true; return []; } };',
        'export const Legacy = (args) => cardTwig(args);',
      ]);

      expectLegacyLines(result, [4]);
      expect(globalThis.__emulsifyStorySelectionExecuted).toBeUndefined();
    });

    it('honors a known exclusion even when the include filter is dynamic', () => {
      expectLegacyLines(
        analyze([
          'export default { includeStories: selectStories(), excludeStories: ["Legacy"] };',
          'export const Legacy = (args) => cardTwig(args);',
        ]),
        [],
      );
    });

    it('tracks unknown selection and inherited rendering without evaluating metadata', () => {
      const source = [
        ...imports,
        'const getMetadata = () => { globalThis.__emulsifyStorySelectionExecuted = true; return {}; };',
        'export default getMetadata();',
        'export const Story = {};',
      ].join('\n');
      const classification = classify(source);

      expect(classification).toMatchObject({
        hasUnknownStorySelection: true,
        hasUnknownStoryRenderPath: true,
      });
      expect(globalThis.__emulsifyStorySelectionExecuted).toBeUndefined();
    });

    it.each([
      'export const Story = createStory();',
      'const first = second; const second = first; export const Story = first;',
      'export const Story = { render: importedRenderer };',
      'export const Story = { render: renderTwig(cardTwig), ...dynamicOptions };',
    ])('retains unknown effective renders: %s', (story) => {
      expect(classify([...imports, story].join('\n'))).toMatchObject({
        legacy: [],
        hasUnknownStoryRenderPath: true,
      });
    });
  });
});
