/**
 * @file Regression tests for independent modern and legacy story render paths.
 */

import { analyzeStorySource } from '../../../audit-twig-stories.js';

const imports = [
  'import cardTwig from "./card.twig";',
  'import { renderTwig } from "@emulsify/core/storybook";',
];

const analyze = (lines, prelude = imports) =>
  analyzeStorySource([...prelude, ...lines].join('\n'), 'card.stories.js');

const expectLegacy = (result, line) => {
  expect(result).toMatchObject({
    shouldUpgrade: true,
    directTemplateReturns: [{ name: 'cardTwig', line }],
  });
};

const expectClean = (result) => {
  expect(result).toMatchObject({
    shouldUpgrade: false,
    directTemplateReturns: [],
  });
};

describe('independent story render paths', () => {
  const sharedLegacyExports = [
    ['direct export', 'export const Legacy = Template;'],
    ['bound export', 'export const Legacy = Template.bind({});'],
    ['object render', 'export const Legacy = { render: Template };'],
  ];

  describe.each(['modern first', 'legacy first'])('%s', (order) => {
    it.each(sharedLegacyExports)(
      'reports the shared helper used by a legacy %s',
      (description, legacy) => {
        const modern =
          'export const Modern = { render: renderTwig(Template) };';
        const exports =
          order === 'modern first' ? [modern, legacy] : [legacy, modern];
        const result = analyze([
          'const Template = (args) => cardTwig(args);',
          ...exports,
        ]);

        // Existing bound-template reports point to the helper declaration.
        expectLegacy(result, 3);
      },
    );
  });

  it('keeps an aliased renderTwig import local to its modern render path', () => {
    const result = analyze(
      [
        'const Template = (args) => cardTwig(args);',
        'export const Modern = { render: rt(Template) };',
        'export const Legacy = { render: (args) => Template(args) };',
      ],
      [
        'import cardTwig from "./card.twig";',
        'import { renderTwig as rt } from "@emulsify/core/storybook";',
      ],
    );

    expectLegacy(result, 5);
  });

  it.each([
    [
      'local alias',
      'export const Legacy = (args) => { const local = Template; return local(args); };',
    ],
    [
      'local function helper',
      'export const Legacy = (args) => { function local(data) { return Template(data); } return local(args); };',
    ],
  ])(
    'follows a %s on the legacy path after modern use',
    (description, legacy) => {
      const result = analyze([
        'const Template = (args) => cardTwig(args);',
        'export const Modern = { render: renderTwig(Template) };',
        legacy,
      ]);

      expectLegacy(result, 5);
    },
  );

  it.each([
    ['parameter', 'export const Story = (cardTwig) => cardTwig({});'],
    [
      'block declaration',
      'export const Story = () => { const cardTwig = () => "local HTML"; return cardTwig({}); };',
    ],
    [
      'enclosing closure parameter',
      'function makeRenderer(cardTwig) { return () => cardTwig({}); }\nexport const Story = makeRenderer(() => "local HTML");',
    ],
  ])(
    'does not mistake a Twig %s shadow for the import',
    (description, story) => {
      expectClean(analyze([story]));
    },
  );

  it('resolves a module helper in its declaration scope despite a caller parameter shadow', () => {
    const result = analyze([
      'const Template = (args) => cardTwig(args);',
      'export const Modern = { render: renderTwig(Template) };',
      'export const Legacy = (cardTwig) => Template({});',
    ]);

    expectLegacy(result, 5);
  });

  it('retains a local helper closure when called from a block that shadows Twig', () => {
    const result = analyze([
      'export const Legacy = () => {',
      '  const local = () => cardTwig({});',
      '  {',
      '    const cardTwig = () => "unrelated local HTML";',
      '    return local();',
      '  }',
      '};',
    ]);

    expectLegacy(result, 3);
  });

  it.each([
    [
      'parameter',
      'export const Legacy = (renderTwig) => renderTwig((args) => cardTwig(args));',
    ],
    [
      'block declaration',
      'export const Legacy = () => { const renderTwig = (callback) => callback({}); return renderTwig(cardTwig); };',
    ],
  ])(
    'does not treat a renderTwig %s shadow as the modern helper',
    (description, story) => {
      expectLegacy(analyze([story]), 3);
    },
  );

  it('retains the imported renderTwig binding in a closure called under a shadow', () => {
    expectClean(
      analyze([
        'export const Modern = () => {',
        '  const local = () => renderTwig(cardTwig);',
        '  {',
        '    const renderTwig = (callback) => callback({});',
        '    return local();',
        '  }',
        '};',
      ]),
    );
  });

  it('resolves a module const alias of renderTwig despite a caller parameter shadow', () => {
    expectClean(
      analyze([
        'const renderer = renderTwig;',
        'const Template = (args) => cardTwig(args);',
        'export const Modern = (renderTwig) => renderer(Template);',
      ]),
    );
  });

  it('retains a local renderTwig alias captured before caller block shadows', () => {
    expectClean(
      analyze([
        'export const Modern = () => {',
        '  const renderer = renderTwig;',
        '  const local = () => renderer(cardTwig);',
        '  {',
        '    const renderTwig = (callback) => callback({});',
        '    const renderer = renderTwig;',
        '    return local();',
        '  }',
        '};',
      ]),
    );
  });

  it('follows a returned bound local helper to its Twig return', () => {
    const result = analyze([
      'export const Legacy = () => {',
      '  const local = (args) => cardTwig(args);',
      '  return local.bind({});',
      '};',
    ]);

    expectLegacy(result, 3);
  });

  it('classifies an object member helper separately for modern and legacy paths', () => {
    const result = analyze([
      'const helpers = { template: (args) => cardTwig(args) };',
      'export const Modern = { render: renderTwig(helpers.template) };',
      'export const Legacy = { render: helpers.template };',
    ]);

    expectLegacy(result, 5);
  });

  it('recognizes the modern callee stored in a static object member', () => {
    expectClean(
      analyze([
        'const helpers = { render: renderTwig };',
        'const Template = (args) => cardTwig(args);',
        'export const Modern = { render: helpers.render(Template) };',
      ]),
    );
  });

  it.each([
    'export const Story = () => ({ cardTwig: "plain value" });',
    'const labels = { cardTwig: "plain value" };\nexport const Story = () => labels.cardTwig;',
  ])(
    'does not confuse a property named cardTwig with the import: %s',
    (story) => {
      expectClean(analyze([story]));
    },
  );

  it('detects a recursive shared helper without letting its modern use suppress legacy use', () => {
    const result = analyze([
      'const Template = (args) => args.recurse ? Template({ ...args, recurse: false }) : cardTwig(args);',
      'export const Modern = { render: renderTwig(Template) };',
      'export const Legacy = Template;',
    ]);

    expectLegacy(result, 3);
  });

  it('terminates on cyclic helpers with no reachable Twig return', () => {
    expectClean(
      analyze([
        'const first = () => second();',
        'const second = () => first();',
        'export const Story = first;',
      ]),
    );
  });

  it('finds a reachable Twig return through mutually recursive helpers', () => {
    const result = analyze([
      'const first = (args) => args.stop ? cardTwig(args) : second(args);',
      'const second = (args) => first(args);',
      'export const Legacy = second;',
    ]);

    expectLegacy(result, 4);
  });

  it('terminates a cyclic alias chain without inventing a Twig return', () => {
    expectClean(
      analyze([
        'const first = second;',
        'const second = first;',
        'export const Story = first;',
      ]),
    );
  });

  it('finds a later Twig branch after an earlier branch revisits recursive helpers', () => {
    const result = analyze([
      'const first = (args) => args.recurse ? second(args) : cardTwig(args);',
      'const second = (args) => first(args);',
      'export const Legacy = (args) => first(args);',
    ]);

    expectLegacy(result, 5);
  });

  describe.each([
    ['with a renderTwig import', imports],
    ['without a renderTwig import', [imports[0]]],
  ])('%s', (description, prelude) => {
    it.each([
      [
        'side effect',
        'export const Story = (args) => { console.log(cardTwig(args)); return "plain HTML"; };',
      ],
      [
        'metadata-excluded export',
        'export const getSourceSnippet = () => cardTwig({});\nexport default { excludeStories: ["getSourceSnippet"] };\nexport const Story = () => "plain HTML";',
      ],
      [
        'play function',
        'export const Story = { render: () => "plain HTML", play: () => cardTwig({}) };',
      ],
    ])(
      'does not report Twig use in a %s as a legacy render',
      (usage, story) => {
        expectClean(analyze([story], prelude));
      },
    );
  });

  it('detects a legacy call to a required Twig template without renderTwig', () => {
    const result = analyze(
      [
        'const cardTwig = require("./card.twig");',
        'export const Legacy = (args) => cardTwig(args);',
      ],
      [],
    );

    expectLegacy(result, 2);
  });

  it('keeps a required shared template legacy on its direct render path', () => {
    const result = analyze(
      [
        'const Template = (args) => cardTwig(args);',
        'export const Modern = { render: renderTwig(Template) };',
        'export const Legacy = Template.bind({});',
      ],
      ['const cardTwig = require("./card.twig");', imports[1]],
    );

    expectLegacy(result, 3);
  });

  it('keeps a modern-only required Twig template clean', () => {
    expectClean(
      analyze(
        [
          'const Template = (args) => cardTwig(args);',
          'export const Modern = { render: renderTwig(Template) };',
        ],
        ['const cardTwig = require("./card.twig");', imports[1]],
      ),
    );
  });

  it.each([
    'export const Modern = { render: renderTwig(Template) };',
    'export default { render: renderTwig(withContainer(Template)) };\nexport const Modern = {};',
    'export const Modern = { render: renderTwig((args) => Template(args)) };',
  ])('keeps composed modern rendering clean: %s', (story) => {
    expectClean(analyze(['const Template = (args) => cardTwig(args);', story]));
  });
});
