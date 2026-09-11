/**
 * @file Regression tests for Twig render values reached through member access.
 */

import { analyzeStorySource } from '../../../audit-twig-stories.js';

describe('Twig render member paths', () => {
  it('reports a Twig value returned through an array element', () => {
    const source = [
      'import cardTwig from "./card.twig";',
      'export const Legacy = (args) => [cardTwig(args)][0];',
    ].join('\n');

    expect(analyzeStorySource(source)).toMatchObject({
      shouldUpgrade: true,
      directTemplateReturns: [{ name: 'cardTwig', line: 2 }],
    });
  });

  it('reports a Twig value returned through a helper result property', () => {
    const source = [
      'import cardTwig from "./card.twig";',
      'const html = (args) => ({ value: cardTwig(args) });',
      'export const Legacy = (args) => html(args).value;',
    ].join('\n');

    expect(analyzeStorySource(source)).toMatchObject({
      shouldUpgrade: true,
      directTemplateReturns: [{ name: 'cardTwig', line: 3 }],
    });
  });

  it('does not treat a renderer replaced by a spread as renderTwig', () => {
    const source = [
      'import cardTwig from "./card.twig";',
      'import { renderTwig } from "@emulsify/core/storybook";',
      'const renderers = { modern: renderTwig, ...{ modern: (template) => template({}) } };',
      'export const Legacy = { render: renderers.modern(cardTwig) };',
    ].join('\n');

    expect(analyzeStorySource(source)).toMatchObject({
      shouldUpgrade: true,
      directTemplateReturns: [{ name: 'cardTwig', line: 4 }],
    });
  });

  it('does not treat a renderer replaced by a computed property as renderTwig', () => {
    const source = [
      'import cardTwig from "./card.twig";',
      'import { renderTwig } from "@emulsify/core/storybook";',
      'const key = "modern";',
      'const renderers = { modern: renderTwig, [key]: (template) => template({}) };',
      'export const Legacy = { render: renderers.modern(cardTwig) };',
    ].join('\n');

    expect(analyzeStorySource(source)).toMatchObject({
      shouldUpgrade: true,
      directTemplateReturns: [{ name: 'cardTwig', line: 5 }],
    });
  });
});
