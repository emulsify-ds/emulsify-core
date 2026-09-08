/**
 * @file Records current Core output alongside the pinned PHP serialization.
 * PHP expectations are regenerated only by the optional maintainer check.
 */

import Twig from 'twig';
import corpus from '../__fixtures__/parity-v1.json';
import { registerTwigExtensions } from '../register.js';

/**
 * Compare browser-visible attribute values while keeping raw strings in fixtures.
 * A pipe separates repeated helper calls in context-consumption cases.
 *
 * @param {string} rendered - Raw helper output from one or more calls.
 * @returns {Object[]} Parsed HTML attribute maps, one per helper call.
 */
function renderedAttributes(rendered) {
  return rendered.split('|').map((attributes) => {
    const container = document.createElement('div');
    container.innerHTML = `<div ${attributes}></div>`;
    return Object.fromEntries(
      Array.from(container.firstElementChild.attributes, ({ name, value }) => [
        name,
        value,
      ]),
    );
  });
}

describe('Twig/PHP parity corpus v1 (current behavior, not canonical policy)', () => {
  registerTwigExtensions(Twig);

  it.each(corpus.cases)('$id', (sample) => {
    const context = JSON.parse(JSON.stringify(sample.context));
    context.attributes ??= {};
    const rendered = Twig.twig({
      data: sample.template,
      autoescape: false,
    }).render(context);

    expect({
      rendered,
      remainingContextAttributes: context.attributes,
    }).toEqual(sample.expected.core);

    const coreAttributes = renderedAttributes(rendered);
    const phpAttributes = renderedAttributes(sample.expected.php.rendered);
    if (sample.portableAttributes) {
      expect(coreAttributes).toEqual(phpAttributes);
      expect(context.attributes).toEqual(
        sample.expected.php.remainingContextAttributes,
      );
    } else {
      expect(coreAttributes).not.toEqual(phpAttributes);
    }
    // Every unequal raw serialization is documented, even when HTML is equivalent.
    expect(sample.comment).toMatch(/known.*divergence/i);
  });
});
