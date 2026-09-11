/**
 * @file Structured include/source calls and the existing flat reference API.
 */

import {
  findTwigIncludeSourceReferences,
  findTwigReferenceCalls,
} from '../twig.js';
import Twig from 'twig';
import { createTwigIncludeFunction } from '../../../../src/storybook/twig/include-function.js';

describe('Core runtime optionality parity', () => {
  it.each([
    ['item', 'false', false],
    ['card_data', 'false', false],
    ['item.card', 'false', false],
    ['data|merge({a: 1})', 'false', false],
    ['{ 0: item, ignore_missing: false }', 'true', false],
    ['{ 0: item, ignore_missing: true }', 'false', true],
    ['item', 'true', true],
  ])(
    'checks variables %s with positional ignore_missing %s like the runtime',
    (variables, flag, optional) => {
      const expression = `include("missing.twig", ${variables}, true, ${flag})`;
      const runtime = Twig.factory();
      runtime.extendFunction('include', createTwigIncludeFunction());
      const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        runtime.twig({ data: `{{ ${expression} }}`, rethrow: true }).render({
          item: { card: { label: 'Card' } },
          card_data: { label: 'Card' },
          data: { label: 'Card' },
        });
        expect(errors).toHaveBeenCalledTimes(optional ? 0 : 1);
        expect(
          findTwigReferenceCalls(`{{ ${expression} }}`)[0].ignoreMissing,
        ).toBe(optional);
      } finally {
        errors.mockRestore();
      }
    },
  );

  it.each([
    ['{ ignore_missing: true, ignore_missing: false }', false, true],
    ['{ ignore_missing: false, ignore_missing: true }', true, false],
    ['{}', 'FALSE', false],
  ])(
    'matches Twig.js object %s and positional flag %s',
    (variables, flag, optional) => {
      const expression = `include("missing.twig", ${variables}, false, ${flag})`;
      const runtime = Twig.factory();
      runtime.extendFunction('include', createTwigIncludeFunction());
      const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        runtime.twig({ data: `{{ ${expression} }}`, rethrow: true }).render({});
        expect(errors).toHaveBeenCalledTimes(optional ? 0 : 1);
        expect(
          findTwigReferenceCalls(`{{ ${expression} }}`)[0].ignoreMissing,
        ).toBe(optional);
      } finally {
        errors.mockRestore();
      }
    },
  );
});

describe('flat Twig reference compatibility', () => {
  it('keeps its exact reference shape and literal locations for optional calls', () => {
    const source = [
      '{{ include(',
      '  ["first.twig",',
      '    "second.twig"],',
      '  {}, false, true',
      ') }}',
      '{{ source("@assets/optional.svg", ignore_missing: true) }}',
    ].join('\n');

    expect(findTwigIncludeSourceReferences(source)).toEqual([
      { type: 'include', value: 'first.twig', line: 2 },
      { type: 'include', value: 'second.twig', line: 3 },
      { type: 'source', value: '@assets/optional.svg', line: 6 },
    ]);
  });

  it('retains only complete static members of uncertain fallback arrays', () => {
    const source = [
      '{{ include([',
      '  selected_template,',
      '  "static.twig",',
      '  "theme:" ~ component_name,',
      '  choose("nested.twig", { value: ")]," }),',
      '  "last.twig",',
      ']) }}',
    ].join('\n');

    expect(findTwigIncludeSourceReferences(source)).toEqual([
      { type: 'include', value: 'static.twig', line: 3 },
      { type: 'include', value: 'last.twig', line: 6 },
    ]);
  });

  it('still omits wholly dynamic arguments and transformed arrays', () => {
    const source = [
      '{{ include("theme:" ~ component_name) }}',
      '{{ source("@assets/#{icon}.svg") }}',
      '{{ include(["static.twig"] | merge(other_templates)) }}',
      '{{ include(["static.twig"] ~ suffix) }}',
    ].join('\n');

    expect(findTwigIncludeSourceReferences(source)).toEqual([]);
  });

  it('keeps historical source-array flattening for existing callers', () => {
    expect(
      findTwigIncludeSourceReferences(
        '{{ source(["first.svg", dynamic_asset, "last.svg"]) }}',
      ),
    ).toEqual([
      { type: 'source', value: 'first.svg', line: 1 },
      { type: 'source', value: 'last.svg', line: 1 },
    ]);
  });

  it('preserves comment and quoted-code masking inside HTML attributes', () => {
    const source = [
      '{# {{ include("commented.twig") }}',
      '{{ source("commented.svg") }} #}<i title="{{ include(\'real.twig\') }}">',
      String.raw`{% set example = "include('quoted.twig')" %}`,
      '{{ include("literal/{#part#}/card.twig", { label: "source(\'context.svg\')" }) }}',
    ].join('\n');

    expect(findTwigIncludeSourceReferences(source)).toEqual([
      { type: 'include', value: 'real.twig', line: 2 },
      { type: 'include', value: 'literal/{#part#}/card.twig', line: 4 },
    ]);
  });
});

describe('structured Twig reference calls', () => {
  it('groups ordered fallback candidates and preserves call and literal lines', () => {
    const source = [
      '<section>',
      '  {{ include(',
      '    [',
      '      "primary.twig",',
      '      {# "commented.twig", #}',
      '      "fallback.twig",',
      '    ],',
      '    { label: "later-context.twig" }',
      '  ) }}',
      '{{ source(',
      '  "@assets/icon.svg"',
      ') }}',
    ].join('\n');

    expect(findTwigReferenceCalls(source)).toMatchObject([
      {
        type: 'include',
        candidates: [
          { value: 'primary.twig', line: 4 },
          { value: 'fallback.twig', line: 6 },
        ],
        line: 2,
        ignoreMissing: false,
        hasDynamicCandidates: false,
        isFallbackArray: true,
      },
      {
        type: 'source',
        candidates: [{ value: '@assets/icon.svg', line: 11 }],
        line: 10,
        ignoreMissing: false,
        hasDynamicCandidates: false,
      },
    ]);
  });

  it.each([
    ['include("card.twig")', false],
    ['include("card.twig", item)', false],
    ['include("card.twig", card_data)', false],
    ['include("card.twig", item.card)', false],
    ['include("card.twig", data|merge({a: 1}))', false],
    ['include("card.twig", item, true)', false],
    ['include("card.twig", { 0: item, ignore_missing: false })', false],
    ['include("card.twig", item, true, true)', true],
    ['include("card.twig", item, true, optional)', null],
    ['include("card.twig", item, { ignore_missing: true })', true],
    ['include("card.twig", item, { ignore_missing: optional })', null],
    ['include("card.twig", {}, context_options)', null],
    ['include("card.twig", { with_context: context_options })', null],
    ['include("card.twig", { ignore_missing: true })', true],
    ['include("card.twig", {}, true)', false],
    ['include("card.twig", {}, false, true)', true],
    ['include("card.twig", {}, true, false)', false],
    ['include("card.twig", {}, true, optional)', null],
    ['include("card.twig", ignore_missing: true)', null],
    ['include("card.twig", ignore_missing = false)', null],
    ['include("card.twig", ignore_missing: optional)', null],
    ['source("card.twig")', false],
    ['source("card.twig", true)', true],
    ['source("card.twig", false)', false],
    ['source("card.twig", FALSE)', false],
    ['source("card.twig", TRUE)', true],
    ['source("card.twig", NULL)', false],
    ['source("card.twig", 0)', false],
    ['source("card.twig", "")', false],
    ['source("card.twig", "false")', true],
    ['source("card.twig", optional)', null],
    ['source("card.twig", ignore_missing: true)', null],
    ['source("card.twig", ignore_missing = false)', null],
    ['include("card.twig", {}, false, false, true)', false],
    ['include("card.twig", { ignore_missing: true }, false, false)', true],
    ['include("card.twig", { ignore_missing: false }, false, true)', false],
    ['include("card.twig", {}, { ignore_missing: true })', true],
    [
      'include("card.twig", { ignore_missing: false }, { ignore_missing: true })',
      true,
    ],
    [
      'include("card.twig", { ignore_missing: true, with_context: false }, { ignore_missing: false })',
      true,
    ],
    [
      'include("card.twig", { with_context: { ignore_missing: true } }, { ignore_missing: false })',
      true,
    ],
    ['include("card.twig", { nested: { ignore_missing: true } })', false],
    ['include("card.twig", { ignore_missing: optional })', null],
    ['include("card.twig", {}, { ignore_missing: optional })', null],
    ['include("card.twig", FALSE, FALSE, FALSE)', false],
    ['include("card.twig", NULL, NONE, TRUE)', true],
    [
      'include("card.twig", { ignore_missing: true, ignore_missing: false })',
      true,
    ],
    [
      'include("card.twig", { ignore_missing: false, ignore_missing: true })',
      false,
    ],
    [
      'include("card.twig", { (option_name): true, ignore_missing: false, with_context: false })',
      null,
    ],
    [
      'include("card.twig", { ignore_missing: false, (option_name): true, with_context: false })',
      null,
    ],
  ])(
    'reads the missing-reference option in %s',
    (expression, ignoreMissing) => {
      expect(findTwigReferenceCalls(`{{ ${expression} }}`)).toMatchObject([
        {
          type: expression.startsWith('include') ? 'include' : 'source',
          candidates: [{ value: 'card.twig', line: 1 }],
          line: 1,
          ignoreMissing,
          hasDynamicCandidates: false,
        },
      ]);
    },
  );

  it('does not confuse nested variables or later named arguments with options', () => {
    const source = [
      '{{ include(',
      '  "card.twig",',
      '  { ignore_missing: true, nested: [choose(")],", { flag: true })] },',
      '  with_context: false,',
      '  ignore_missing {# explanation #}: decide({ ignore_missing: false })',
      ') }}',
    ].join('\n');

    expect(findTwigReferenceCalls(source)).toMatchObject([
      {
        type: 'include',
        candidates: [{ value: 'card.twig', line: 2 }],
        line: 1,
        ignoreMissing: null,
        hasDynamicCandidates: false,
      },
    ]);
  });

  it('retains static candidates and uncertainty in a mixed fallback group', () => {
    const source = [
      '{{ include([',
      '  "static-first.twig",',
      '  selected_template,',
      '  "theme:" ~ component_name,',
      '  choose("nested.twig", { value: ")]," }),',
      '  "static-last.twig",',
      ']) }}',
    ].join('\n');

    expect(findTwigReferenceCalls(source)).toMatchObject([
      {
        type: 'include',
        candidates: [
          { value: 'static-first.twig', line: 2 },
          { value: 'static-last.twig', line: 6 },
        ],
        line: 1,
        ignoreMissing: false,
        hasDynamicCandidates: true,
        isFallbackArray: true,
      },
    ]);
  });

  it('distinguishes an empty static include fallback list from dynamic candidates', () => {
    expect(findTwigReferenceCalls('{{ include([]) }}')).toMatchObject([
      {
        type: 'include',
        candidates: [],
        line: 1,
        ignoreMissing: false,
        hasDynamicCandidates: false,
        isFallbackArray: true,
      },
    ]);
  });

  it('does not claim source arrays have include fallback semantics', () => {
    expect(
      findTwigReferenceCalls('{{ source(["first.svg", "last.svg"]) }}'),
    ).toMatchObject([
      {
        type: 'source',
        candidates: [],
        line: 1,
        ignoreMissing: false,
        hasDynamicCandidates: true,
        isFallbackArray: false,
      },
    ]);
  });

  it.each([
    'template_name',
    '"theme:" ~ component_name',
    '"components/#{component_name}.twig"',
    'choose("nested.twig", options(["x", "y"]))',
    '["first.twig"] | merge(other_templates)',
    '["first.twig"] ~ suffix',
  ])(
    'records an uncertain candidate expression without fragments: %s',
    (argument) => {
      expect(
        findTwigReferenceCalls(`{{ include(${argument}) }}`),
      ).toMatchObject([
        {
          type: 'include',
          candidates: [],
          line: 1,
          ignoreMissing: false,
          hasDynamicCandidates: true,
        },
      ]);
    },
  );

  it('discovers genuine nested calls while ignoring quoted call text', () => {
    const source = [
      '{{ include("outer.twig", {',
      '  content: source("@assets/inner.svg", true),',
      String.raw`  label: "include('quoted.twig')"`,
      '}) }}',
    ].join('\n');

    expect(findTwigReferenceCalls(source)).toMatchObject([
      {
        type: 'include',
        candidates: [{ value: 'outer.twig', line: 1 }],
        line: 1,
        ignoreMissing: false,
        hasDynamicCandidates: false,
      },
      {
        type: 'source',
        candidates: [{ value: '@assets/inner.svg', line: 2 }],
        line: 2,
        ignoreMissing: true,
        hasDynamicCandidates: false,
      },
    ]);
  });

  it('keeps single-quoted interpolation text and escaped punctuation literal', () => {
    const source = [
      String.raw`{{ include('components/#{name}/it\'s-(card),[x].twig') }}`,
      String.raw`{{ source("@assets/quote\"(x),[y].svg") }}`,
    ].join('\n');

    expect(findTwigReferenceCalls(source)).toMatchObject([
      {
        type: 'include',
        candidates: [
          {
            value: String.raw`components/#{name}/it's-(card),[x].twig`,
            line: 1,
          },
        ],
        line: 1,
        hasDynamicCandidates: false,
      },
      {
        type: 'source',
        candidates: [{ value: '@assets/quote"(x),[y].svg', line: 2 }],
        line: 2,
        hasDynamicCandidates: false,
      },
    ]);
  });

  it('ignores comments and quoted code while preserving punctuation in filenames', () => {
    const source = [
      '{# {{ include("commented.twig") }}',
      '{{ source("commented.svg") }} #}<i title="{{ include(\'real.twig\') }}">',
      String.raw`{% set example = "include('quoted.twig')" %}`,
      '{{ include("literal/{#part#}/(card),[variant].twig") }}',
    ].join('\n');

    expect(findTwigReferenceCalls(source)).toMatchObject([
      {
        type: 'include',
        candidates: [{ value: 'real.twig', line: 2 }],
        line: 2,
        ignoreMissing: false,
        hasDynamicCandidates: false,
      },
      {
        type: 'include',
        candidates: [
          { value: 'literal/{#part#}/(card),[variant].twig', line: 4 },
        ],
        line: 4,
        ignoreMissing: false,
        hasDynamicCandidates: false,
      },
    ]);
  });

  it.each([
    '{{ include("incomplete.twig" }}',
    '{{ include(["mismatched.twig"}) }}',
    '{{ example.include("member.twig") }}',
  ])('ignores incomplete or non-function reference text: %s', (source) => {
    expect(findTwigReferenceCalls(source)).toEqual([]);
  });
});
