/**
 * @file Tests for static include/source references used by the Twig audit.
 */

import { findTwigIncludeSourceReferences } from './twig.js';

describe('findTwigIncludeSourceReferences', () => {
  it('ignores object methods named include or source', () => {
    expect(
      findTwigIncludeSourceReferences(
        '{{ example.include("member.twig") }} {{ example . source("member.svg") }}',
      ),
    ).toEqual([]);
  });

  it('reads complete static include/source arguments and ignores later context', () => {
    const source = [
      '{{ include(  "@components/card/card.twig"  , { label: "context.twig" }, with_context: false) }}',
      '{{ source( "@assets/icons/mark.svg", ignore_missing: true ) }}',
    ].join('\n');

    expect(findTwigIncludeSourceReferences(source)).toEqual([
      { type: 'include', value: '@components/card/card.twig', line: 1 },
      { type: 'source', value: '@assets/icons/mark.svg', line: 2 },
    ]);
  });

  it.each([
    '{{ include("naswa:" ~ component_name) }}',
    '{{ include(component_name ~ ".twig") }}',
    '{{ source("@assets/" ~ icon ~ ".svg") }}',
    '{{ include(enabled ? "first.twig" : "second.twig") }}',
    '{{ include("first.twig" | default("second.twig")) }}',
    '{{ include(("wrapped.twig")) }}',
    '{{ include(template_name, { fallback: "later-context.twig" }) }}',
    '{{ include("@components/#{component_name}.twig") }}',
    '{{ source("@assets/#{icon}.svg") }}',
    '{{ include(["first.twig"] | merge(other_templates)) }}',
    '{{ include(["first.twig"] ~ suffix) }}',
  ])('ignores dynamic first arguments: %s', (source) => {
    expect(findTwigIncludeSourceReferences(source)).toEqual([]);
  });

  it('reads each complete literal in a static fallback array', () => {
    expect(
      findTwigIncludeSourceReferences(
        '{{ include([ "first.twig", "second.twig", ], { label: "context.twig" }) }}',
      ),
    ).toEqual([
      { type: 'include', value: 'first.twig', line: 1 },
      { type: 'include', value: 'second.twig', line: 1 },
    ]);
  });

  it('keeps only whole quoted elements from mixed fallback arrays', () => {
    const source = [
      '{{ include([',
      '  "static-first.twig",',
      '  "naswa:" ~ component_name,',
      '  component_name ~ ".twig",',
      '  enabled ? "ternary-first.twig" : "ternary-second.twig",',
      '  choose("function-argument.twig", ["nested.twig"]),',
      '  { key: "object-value.twig" },',
      '  ["nested-array.twig"],',
      '  "static-last.twig"',
      '], { label: "later-context.twig" }) }}',
    ].join('\n');

    expect(findTwigIncludeSourceReferences(source)).toEqual([
      { type: 'include', value: 'static-first.twig', line: 2 },
      { type: 'include', value: 'static-last.twig', line: 9 },
    ]);
  });

  it('ignores Twig comments while preserving original multiline locations', () => {
    const source = [
      '{# {{ include("commented.twig") }}',
      '{{ source("commented.svg") }} #}',
      '{{ include(',
      '  [',
      '    "first.twig",',
      '    {# "commented-element.twig", #}',
      '    "naswa:" ~ component_name,',
      '    "second.twig"',
      '  ],',
      '  { label: "context.twig" }',
      ') }}',
      '{{ source(',
      '  "@assets/mark.svg"',
      ') }}',
    ].join('\n');

    expect(findTwigIncludeSourceReferences(source)).toEqual([
      { type: 'include', value: 'first.twig', line: 5 },
      { type: 'include', value: 'second.twig', line: 8 },
      { type: 'source', value: '@assets/mark.svg', line: 13 },
    ]);
  });

  it('balances nested dynamic calls before a subsequent static reference', () => {
    const source = [
      '{{ include(choose("dynamic.twig", transform(["x", "y"], options("("))), { label: "context.twig" }) }}',
      '{{ source("@assets/after.svg") }}',
    ].join('\n');

    expect(findTwigIncludeSourceReferences(source)).toEqual([
      { type: 'source', value: '@assets/after.svg', line: 2 },
    ]);
  });

  it('keeps commas and brackets inside a quoted filename', () => {
    expect(
      findTwigIncludeSourceReferences(
        '{{ include("components/(card),[variant].twig", { label: "context)" }) }}',
      ),
    ).toEqual([
      { type: 'include', value: 'components/(card),[variant].twig', line: 1 },
    ]);
  });

  it('decodes escaped quotes while retaining quoted punctuation', () => {
    const source = [
      String.raw`{{ include('components/it\'s-(card),[variant].twig') }}`,
      String.raw`{{ source("@assets/icons/quote\"(x),[y].svg") }}`,
    ].join('\n');

    expect(findTwigIncludeSourceReferences(source)).toEqual([
      {
        type: 'include',
        value: String.raw`components/it's-(card),[variant].twig`,
        line: 1,
      },
      {
        type: 'source',
        value: '@assets/icons/quote"(x),[y].svg',
        line: 2,
      },
    ]);
  });

  it('keeps interpolation syntax literal inside single-quoted strings', () => {
    expect(
      findTwigIncludeSourceReferences(
        String.raw`{{ include('components/#{component_name}.twig') }}`,
      ),
    ).toEqual([
      {
        type: 'include',
        value: 'components/#{component_name}.twig',
        line: 1,
      },
    ]);
  });

  it('ignores function-call text inside later context strings', () => {
    expect(
      findTwigIncludeSourceReferences(
        String.raw`{{ include('card.twig', { label: "include('ignored.twig')", source_label: "source('ignored.svg')" }) }}`,
      ),
    ).toEqual([{ type: 'include', value: 'card.twig', line: 1 }]);
  });

  it('ignores quoted example code in Twig statements but finds the next real call', () => {
    const source = [
      String.raw`{% set example = "include('fake.twig')" %}`,
      '{{ include("real.twig") }}',
    ].join('\n');

    expect(findTwigIncludeSourceReferences(source)).toEqual([
      { type: 'include', value: 'real.twig', line: 2 },
    ]);
  });

  it('discovers real Twig calls inside quoted HTML attributes', () => {
    expect(
      findTwigIncludeSourceReferences(
        String.raw`<div data-template="{{ include('card.twig') }}" data-icon="{{ source('@assets/icon.svg') }}"></div>`,
      ),
    ).toEqual([
      { type: 'include', value: 'card.twig', line: 1 },
      { type: 'source', value: '@assets/icon.svg', line: 1 },
    ]);
  });

  it('preserves literal Twig comment markers inside a quoted filename', () => {
    expect(
      findTwigIncludeSourceReferences(
        '{{ include("components/{#literal#}/card.twig") }}',
      ),
    ).toEqual([
      { type: 'include', value: 'components/{#literal#}/card.twig', line: 1 },
    ]);
  });
});
