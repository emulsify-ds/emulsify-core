import Twig from 'twig';
import { AttributeBag } from '../../shared/attributes.js';
import { bemAttributes } from '../functions/bem.js';
import { registerTwigExtensions } from '../register.js';

describe('bemAttributes', () => {
  it('builds a simple block class', () => {
    expect(String(bemAttributes('title'))).toBe('class="title"');
  });

  it('builds block modifiers', () => {
    expect(String(bemAttributes('title', ['small', 'red']))).toBe(
      'class="title title--small title--red"',
    );
  });

  it('builds element classes with a block name', () => {
    expect(String(bemAttributes('title', ['small', 'red'], 'card'))).toBe(
      'class="card__title card__title--small card__title--red"',
    );
  });

  it('adds extra non-BEM classes', () => {
    expect(
      String(bemAttributes('title', ['small'], 'card', ['js-click'])),
    ).toBe('class="card__title card__title--small js-click"');
  });

  it('supports object syntax for future extension readability', () => {
    expect(
      String(
        bemAttributes({
          block: 'card',
          element: 'title',
          modifiers: ['small'],
          extra: ['js-click'],
        }),
      ),
    ).toBe('class="card__title card__title--small js-click"');
  });

  it('deduplicates and cleans class names', () => {
    expect(
      String(bemAttributes('button', ['red!'], '', ['red!', 'button'])),
    ).toBe('class="button button--red red"');
  });

  it('merges explicit attributes', () => {
    expect(
      String(
        bemAttributes('button', [], '', [], { id: 'primary', disabled: true }),
      ),
    ).toBe('id="primary" disabled class="button"');
  });

  it('returns an AttributeBag for safe composition', () => {
    expect(bemAttributes('button')).toBeInstanceOf(AttributeBag);
  });
});

describe('registered bem Twig function', () => {
  it('renders in Twig.js templates', () => {
    registerTwigExtensions(Twig);

    const template = Twig.twig({
      data: '<h1 {{ bem("title", ["small"]) }}></h1>',
    });

    expect(template.render({})).toBe('<h1 class="title title--small"></h1>');
  });

  it('merges and clears context attributes', () => {
    registerTwigExtensions(Twig);

    const template = Twig.twig({
      data: '<h1 {{ bem("title") }}></h1>',
    });
    const context = {
      attributes: {
        class: ['from-context'],
        id: 'headline',
      },
    };

    expect(template.render(context)).toBe(
      '<h1 class="title from-context" id="headline"></h1>',
    );
    expect(context.attributes).toEqual({});
  });
});
