/**
 * @file Tests for the native `add_attributes()` Twig helper.
 */

import Twig from 'twig';
import { addAttributes } from '../functions/add-attributes.js';
import { bemAttributes } from '../functions/bem.js';
import { registerTwigExtensions } from '../register.js';

/**
 * Pure attribute builder coverage keeps serialization independent from Twig.js.
 */
describe('addAttributes', () => {
  it('serializes scalar and list attributes', () => {
    expect(
      String(
        addAttributes({
          class: ['foo', 'bar'],
          baz: ['foobar', 'goobar'],
          foobaz: 'goobaz',
        }),
      ),
    ).toBe('class="foo bar" baz="foobar goobar" foobaz="goobaz"');
  });

  it('composes with bem output without raw string parsing', () => {
    expect(
      String(
        addAttributes({
          class: bemAttributes('foo', ['bar', 'baz'], 'foobar'),
        }),
      ),
    ).toBe('class="foobar__foo foobar__foo--bar foobar__foo--baz"');
  });

  it('escapes attribute values and ignores unsafe names', () => {
    expect(
      String(
        addAttributes({
          title: '"quoted" & <tag>',
          'bad attr': 'ignored',
        }),
      ),
    ).toBe('title="&quot;quoted&quot; &amp; &lt;tag&gt;"');
  });

  it('renders true boolean attributes and skips falsey attributes', () => {
    expect(
      String(
        addAttributes({
          disabled: true,
          hidden: false,
          inert: null,
          draggable: 0,
        }),
      ),
    ).toBe('disabled draggable="0"');
  });

  /**
   * Context merge coverage protects the Drupal-compatible print-once behavior.
   */
  it('merges context attributes before additional attributes', () => {
    const invocationContext = {
      context: {
        attributes: {
          class: ['existing'],
          id: 'card',
        },
      },
    };

    expect(
      String(
        addAttributes(
          { class: ['new'], 'data-state': 'ready' },
          invocationContext,
        ),
      ),
    ).toBe('class="existing new" id="card" data-state="ready"');
    // Context attributes are cleared after rendering to match Drupal output.
    expect(invocationContext.context.attributes).toEqual({});
  });
});

/**
 * Twig.js registration coverage verifies the public template API.
 */
describe('registered add_attributes Twig function', () => {
  it('renders in Twig.js templates', () => {
    registerTwigExtensions(Twig);

    const template = Twig.twig({
      data: '<div {{ add_attributes(attrs) }}></div>',
    });

    expect(
      template.render({
        attrs: {
          class: ['foo', 'bar'],
          disabled: true,
        },
      }),
    ).toBe('<div class="foo bar" disabled></div>');
  });

  it('accepts bem output in Twig.js templates', () => {
    registerTwigExtensions(Twig);

    const template = Twig.twig({
      data: '<div {{ add_attributes({ class: bem("foo", ["bar"], "card") }) }}></div>',
    });

    expect(template.render({})).toBe(
      '<div class="card__foo card__foo--bar"></div>',
    );
  });
});
