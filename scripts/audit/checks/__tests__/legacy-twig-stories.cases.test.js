/**
 * @file Characterization cases for legacy Twig story detection.
 */

import { analyzeStorySource } from '../../../audit-twig-stories.js';

describe('legacy Twig story detection cases', () => {
  it('A. treats a wrapped renderTwig helper as clean (known false positive)', () => {
    const source = [
      'import ctaTwig from "./cta.twig";',
      'import { renderTwig } from "@emulsify/core/storybook";',
      'const renderCta = (args) => ctaTwig(context(args));',
      'export default { render: renderTwig(withContainer(renderCta)) };',
      'export const Default = {};',
    ].join('\n');

    expect(analyzeStorySource(source).shouldUpgrade).toBe(false);
  });

  it('B. treats an inline renderTwig callback as clean (known false positive)', () => {
    const source = [
      'import cardTwig from "./card.twig";',
      'import { renderTwig } from "@emulsify/core/storybook";',
      'export default { render: renderTwig((args) => cardTwig(args)) };',
      'export const Default = {};',
    ].join('\n');

    expect(analyzeStorySource(source).shouldUpgrade).toBe(false);
  });

  it('C. treats renderTwig with context as clean', () => {
    const source = [
      'import cardTwig from "./card.twig";',
      'import { renderTwig } from "@emulsify/core/storybook";',
      'export default { render: renderTwig(cardTwig, { context }) };',
      'export const Default = {};',
    ].join('\n');

    expect(analyzeStorySource(source).shouldUpgrade).toBe(false);
  });

  it('D. warns for a legacy bound template', () => {
    const source = [
      'import cardTwig from "./card.twig";',
      'const Template = (args) => cardTwig(args);',
      'export const Card = Template.bind({});',
    ].join('\n');

    const result = analyzeStorySource(source);

    expect(result).toMatchObject({
      shouldUpgrade: true,
      directTemplateReturns: [{ name: 'cardTwig', line: 2 }],
    });
  });

  it('E. warns at the Legacy export in a mixed file (known false negative)', () => {
    const source = [
      'import cardTwig from "./card.twig";',
      'import { renderTwig } from "@emulsify/core/storybook";',
      'export const Modern = { render: renderTwig(cardTwig) };',
      'export const Legacy = (args) => { const html = cardTwig(args); return html; };',
    ].join('\n');

    const result = analyzeStorySource(source);

    expect({
      shouldUpgrade: result.shouldUpgrade,
      finding: result.directTemplateReturns[0],
    }).toEqual({
      shouldUpgrade: true,
      finding: { name: 'cardTwig', line: 4 },
    });
  });

  it('F. treats an aliased renderTwig helper as clean (known false positive)', () => {
    const source = [
      'import cardTwig from "./card.twig";',
      'import { renderTwig as rt } from "@emulsify/core/storybook";',
      'const render = (args) => cardTwig(args);',
      'export default { render: rt(render) };',
      'export const Default = {};',
    ].join('\n');

    expect(analyzeStorySource(source).shouldUpgrade).toBe(false);
  });

  it('G. warns with a line for renderTwig imported from the bare package', () => {
    const source = [
      'import cardTwig from "./card.twig";',
      'import { renderTwig } from "@emulsify/core";',
      'export default { render: renderTwig((args) => cardTwig(args)) };',
      'export const Default = {};',
    ].join('\n');

    const result = analyzeStorySource(source);
    const line = result.directTemplateReturns[0]?.line;

    expect(result.hasRenderTwig).toBe(false);
    expect(result.shouldUpgrade).toBe(true);
    expect(result.directTemplateReturns).toEqual([
      { name: 'cardTwig', line: 3 },
    ]);
    expect(Number.isInteger(line)).toBe(true);
  });

  it('H. ignores an explicitly excluded Twig source helper', () => {
    const source = [
      'import cardTwig from "./card.twig";',
      'import { renderTwig } from "@emulsify/core/storybook";',
      'export const getSourceSnippet = () => cardTwig({});',
      'export default { render: renderTwig(cardTwig), excludeStories: ["getSourceSnippet"] };',
      'export const Default = {};',
    ].join('\n');

    expect(analyzeStorySource(source).shouldUpgrade).toBe(false);
  });
});
