/**
 * @file Tests for the public custom element Storybook renderer.
 */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as storybookHelpers from '@emulsify/core/storybook';

const { defineCustomElement, renderWebComponent } = storybookHelpers;

describe('custom element Storybook helpers', () => {
  let container;
  let root;
  let tagIndex = 0;

  const nextTagName = () => {
    tagIndex += 1;
    return `emulsify-test-${tagIndex}`;
  };

  beforeAll(() => {
    /**
     * Tell React that this jsdom suite intentionally wraps renders in act().
     *
     * React 18 prints warnings without this flag when tests use createRoot().
     */
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('exports the precise public helper name without the unreleased alias', () => {
    expect(typeof defineCustomElement).toBe('function');
    expect(typeof renderWebComponent).toBe('function');
    expect(storybookHelpers.defineComponent).toBeUndefined();
  });

  it('defines a custom element once without warning for the same constructor', () => {
    const tagName = nextTagName();
    class FirstElement extends HTMLElement {}
    const warn = jest.spyOn(console, 'warn').mockImplementation();

    expect(defineCustomElement(tagName, FirstElement)).toBe(FirstElement);
    expect(defineCustomElement(tagName, FirstElement)).toBe(FirstElement);
    expect(customElements.get(tagName)).toBe(FirstElement);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and returns the registered constructor when HMR supplies a different one', () => {
    const tagName = nextTagName();
    class FirstElement extends HTMLElement {}
    class ReplacementElement extends HTMLElement {}
    const warn = jest.spyOn(console, 'warn').mockImplementation();

    defineCustomElement(tagName, FirstElement);

    expect(defineCustomElement(tagName, ReplacementElement)).toBe(FirstElement);
    expect(customElements.get(tagName)).toBe(FirstElement);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /already defined with FirstElement.*ReplacementElement was not registered.*Reload Storybook/,
      ),
    );
  });

  it.each([
    'Example-card',
    'examplecard',
    '-example-card',
    'example card',
    'example/card',
    'example>card',
    'example-!',
    'example-:',
    'example-"',
    'example-<',
    'annotation-xml',
  ])('rejects invalid custom element tag name %p', (tagName) => {
    class InvalidElement extends HTMLElement {}

    expect(() => defineCustomElement(tagName, InvalidElement)).toThrow(
      /Invalid custom element tag name/,
    );
    expect(() => renderWebComponent(tagName)).toThrow(
      /Invalid custom element tag name/,
    );
  });

  it('accepts Unicode permitted by the custom element name rules', () => {
    expect(() => renderWebComponent('emotion-😍')).not.toThrow();
  });

  it('rejects values that cannot construct an HTMLElement', () => {
    class PlainClass {}
    const tagName = nextTagName();

    expect(() => defineCustomElement(tagName, null)).toThrow(
      /constructable class.*inherits from HTMLElement/,
    );
    expect(() => defineCustomElement(tagName, () => {})).toThrow(
      /constructable class.*inherits from HTMLElement/,
    );
    expect(() => defineCustomElement(tagName, PlainClass)).toThrow(
      /constructable class.*inherits from HTMLElement/,
    );
  });

  it('rejects customized built-in constructors and registration options', () => {
    class BuiltInElement extends HTMLButtonElement {}
    class AutonomousElement extends HTMLElement {}

    expect(() => defineCustomElement(nextTagName(), BuiltInElement)).toThrow(
      /extend HTMLElement rather than HTMLButtonElement/,
    );
    expect(() =>
      defineCustomElement(nextTagName(), AutonomousElement, {
        extends: 'button',
      }),
    ).toThrow(/option "extends".*not supported/);
  });

  it('accepts autonomous elements derived from a user-defined base class', () => {
    class BaseElement extends HTMLElement {}
    class DerivedElement extends BaseElement {}
    const tagName = nextTagName();

    expect(defineCustomElement(tagName, DerivedElement)).toBe(DerivedElement);
  });

  it('validates argsAs when the render function is created', () => {
    const tagName = nextTagName();

    for (const argsAs of [null, '', 'property', true]) {
      expect(() => renderWebComponent(tagName, { argsAs })).toThrow(
        /option "argsAs".*Expected "properties" or "attributes"/,
      );
    }

    expect(() =>
      renderWebComponent(tagName, { argsAs: 'properties' }),
    ).not.toThrow();
    expect(() =>
      renderWebComponent(tagName, { argsAs: 'attributes' }),
    ).not.toThrow();
  });

  it('validates native event mappings when the render function is created', () => {
    const tagName = nextTagName();

    expect(() => renderWebComponent(tagName, { events: [] })).toThrow(
      /option "events".*object mapping/,
    );
    expect(() =>
      renderWebComponent(tagName, { events: { '': 'onSelect' } }),
    ).toThrow(/event names must be non-empty strings/);
    expect(() =>
      renderWebComponent(tagName, {
        events: { 'card-select': '' },
      }),
    ).toThrow(/events\.card-select.*callback arg name/);
  });

  it('applies property args and clears omitted values through custom setters', () => {
    const tagName = nextTagName();
    class PropertyElement extends HTMLElement {
      set payload(value) {
        this.payloadValue = value;
        this.payloadUpdates = [...(this.payloadUpdates || []), value];
      }

      set items(value) {
        this.itemsValue = value;
      }

      set onSelect(value) {
        this.onSelectValue = value;
      }
    }
    defineCustomElement(tagName, PropertyElement);

    const storyRender = renderWebComponent(tagName);
    const payload = { label: 'First' };
    const items = ['alpha', 'beta'];
    const onSelect = jest.fn();

    act(() => {
      root.render(
        storyRender({
          payload,
          items,
          onSelect,
          children: 'Default slot content',
          key: 'ignored',
          ref: 'ignored',
        }),
      );
    });

    const element = container.querySelector(tagName);
    expect(element.payloadValue).toBe(payload);
    expect(element.itemsValue).toBe(items);
    expect(element.onSelectValue).toBe(onSelect);
    expect(element.textContent).toBe('Default slot content');
    expect(element.key).toBeUndefined();
    expect(element.ref).toBeUndefined();

    act(() => {
      root.render(storyRender({ items }));
    });

    expect(container.querySelector(tagName)).toBe(element);
    expect(element.payloadValue).toBeUndefined();
    expect(element.payloadUpdates).toEqual([payload, undefined]);
    expect(element.itemsValue).toBe(items);
    expect(element.onSelectValue).toBeUndefined();
  });

  it('applies attribute args and removes false, null, undefined, and omitted values', () => {
    const tagName = nextTagName();
    class AttributeElement extends HTMLElement {}
    defineCustomElement(tagName, AttributeElement);

    const storyRender = renderWebComponent(tagName, {
      argsAs: 'attributes',
    });

    act(() => {
      root.render(
        storyRender({
          active: true,
          count: 2,
          detail: { source: 'object' },
          label: 'Greeting',
          nullable: 'present',
          optional: 'present',
          stale: 'remove me',
        }),
      );
    });

    const element = container.querySelector(tagName);
    expect(element.getAttribute('active')).toBe('');
    expect(element.getAttribute('count')).toBe('2');
    expect(element.getAttribute('detail')).toBe('[object Object]');
    expect(element.getAttribute('label')).toBe('Greeting');

    act(() => {
      root.render(
        storyRender({
          active: false,
          count: 3,
          detail: undefined,
          label: null,
          nullable: null,
          optional: undefined,
        }),
      );
    });

    expect(element.hasAttribute('active')).toBe(false);
    expect(element.getAttribute('count')).toBe('3');
    expect(element.hasAttribute('detail')).toBe(false);
    expect(element.hasAttribute('label')).toBe(false);
    expect(element.hasAttribute('nullable')).toBe(false);
    expect(element.hasAttribute('optional')).toBe(false);
    expect(element.hasAttribute('stale')).toBe(false);
  });

  it('renders and removes light DOM children for a default slot', () => {
    const tagName = nextTagName();
    class SlottedElement extends HTMLElement {
      constructor() {
        super();
        const shadowRoot = this.attachShadow({ mode: 'open' });
        shadowRoot.append(document.createElement('slot'));
      }
    }
    defineCustomElement(tagName, SlottedElement);

    const storyRender = renderWebComponent(tagName);

    act(() => {
      root.render(storyRender({ children: 'First child' }));
    });

    const element = container.querySelector(tagName);
    expect(element.textContent).toBe('First child');
    expect(element.shadowRoot.querySelector('slot')).not.toBeNull();

    act(() => {
      root.render(
        storyRender({
          children: React.createElement('span', null, 'Second child'),
        }),
      );
    });

    expect(element.querySelector('span').textContent).toBe('Second child');

    act(() => {
      root.render(storyRender({}));
    });

    expect(element.childNodes).toHaveLength(0);
  });

  it('connects native custom events to current Storybook callbacks without forwarding them', () => {
    const tagName = nextTagName();
    class EventElement extends HTMLElement {}
    defineCustomElement(tagName, EventElement);

    const storyRender = renderWebComponent(tagName, {
      events: {
        'card-select': 'onSelect',
      },
    });
    const firstCallback = jest.fn();
    const secondCallback = jest.fn();

    act(() => {
      root.render(storyRender({ onSelect: firstCallback }));
    });

    const element = container.querySelector(tagName);
    const firstEvent = new CustomEvent('card-select', {
      detail: { id: 1 },
    });
    element.dispatchEvent(firstEvent);

    expect(firstCallback).toHaveBeenCalledWith(firstEvent);
    expect(element.onSelect).toBeUndefined();

    act(() => {
      root.render(storyRender({ onSelect: secondCallback }));
    });

    const secondEvent = new CustomEvent('card-select', {
      detail: { id: 2 },
    });
    element.dispatchEvent(secondEvent);

    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).toHaveBeenCalledWith(secondEvent);

    act(() => {
      root.render(storyRender({ onSelect: null }));
    });
    element.dispatchEvent(
      new CustomEvent('card-select', { detail: { id: 3 } }),
    );

    expect(secondCallback).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(storyRender({ onSelect: secondCallback }));
    });
    act(() => {
      root.unmount();
    });
    root = createRoot(container);

    element.dispatchEvent(
      new CustomEvent('card-select', { detail: { id: 4 } }),
    );
    expect(secondCallback).toHaveBeenCalledTimes(1);
  });

  it('rejects non-function callback args for mapped native events', () => {
    const tagName = nextTagName();
    class EventElement extends HTMLElement {}
    defineCustomElement(tagName, EventElement);

    const storyRender = renderWebComponent(tagName, {
      events: {
        'card-select': 'onSelect',
      },
    });
    jest.spyOn(console, 'error').mockImplementation();

    expect(() => {
      act(() => {
        root.render(storyRender({ onSelect: 'not a callback' }));
      });
    }).toThrow(
      /Storybook arg "onSelect".*Expected a function, null, or undefined/,
    );
  });

  it('applies id and className to the custom element without a wrapper', () => {
    const tagName = nextTagName();
    class UnwrappedElement extends HTMLElement {}
    defineCustomElement(tagName, UnwrappedElement);

    const storyRender = renderWebComponent(tagName, {
      className: 'custom-element-story',
      id: 'custom-element-fixture',
    });

    act(() => {
      root.render(storyRender({ label: 'Greeting' }));
    });

    const element = container.querySelector(tagName);
    expect(container.firstElementChild).toBe(element);
    expect(element.id).toBe('custom-element-fixture');
    expect(element.className).toBe('custom-element-story');
    expect(element.label).toBe('Greeting');
    expect(element.argsAs).toBeUndefined();
    expect(element.events).toBeUndefined();
    expect(element.wrapper).toBeUndefined();

    act(() => {
      root.render(
        storyRender({
          id: 'arg-id',
          className: 'arg-class',
        }),
      );
    });
    expect(element.id).toBe('arg-id');
    expect(element.className).toBe('arg-class');

    act(() => {
      root.render(storyRender({}));
    });
    expect(element.id).toBe('custom-element-fixture');
    expect(element.className).toBe('custom-element-story');
  });

  it('applies wrapper options to the wrapper while args target the custom element', () => {
    const tagName = nextTagName();
    class WrappedElement extends HTMLElement {}
    defineCustomElement(tagName, WrappedElement);

    const storyRender = renderWebComponent(tagName, {
      wrapper: 'section',
      className: 'custom-element-story',
      id: 'custom-element-fixture',
    });

    act(() => {
      root.render(
        storyRender({
          className: 'element-class',
          id: 'element-id',
          label: 'Greeting',
        }),
      );
    });

    const wrapper = container.querySelector('section');
    const element = wrapper.querySelector(tagName);
    expect(wrapper.id).toBe('custom-element-fixture');
    expect(wrapper.className).toBe('custom-element-story');
    expect(element.id).toBe('element-id');
    expect(element.className).toBe('element-class');
    expect(element.label).toBe('Greeting');
  });

  it('remounts and repeats module evaluation without redefining the element', () => {
    const tagName = nextTagName();
    class RemountElement extends HTMLElement {}
    defineCustomElement(tagName, RemountElement);

    const storyRender = renderWebComponent(tagName);

    expect(() => {
      act(() => {
        root.render(storyRender({ label: 'First' }));
      });
    }).not.toThrow();

    act(() => {
      root.unmount();
    });
    root = createRoot(container);

    expect(defineCustomElement(tagName, RemountElement)).toBe(RemountElement);
    expect(() => {
      act(() => {
        root.render(storyRender({ label: 'Second' }));
      });
    }).not.toThrow();
  });
});
