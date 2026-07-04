/**
 * @file Tests for the public web component Storybook renderer.
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { defineComponent, renderWebComponent } from '@emulsify/core/storybook';

describe('renderWebComponent', () => {
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
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('defines custom elements idempotently', () => {
    const tagName = nextTagName();
    class FirstElement extends HTMLElement {}
    class ReplacementElement extends HTMLElement {}

    expect(defineComponent(tagName, FirstElement)).toBe(FirstElement);
    expect(defineComponent(tagName, ReplacementElement)).toBe(FirstElement);
    expect(customElements.get(tagName)).toBe(FirstElement);
  });

  it('rejects invalid custom element tag names', () => {
    class InvalidElement extends HTMLElement {}

    expect(() => defineComponent('ExampleCard', InvalidElement)).toThrow(
      /lowercase and contain a hyphen/,
    );
    expect(() => defineComponent('examplecard', InvalidElement)).toThrow(
      /lowercase and contain a hyphen/,
    );
    expect(() => renderWebComponent('ExampleCard')).toThrow(
      /lowercase and contain a hyphen/,
    );
  });

  it('applies args as properties by default and reapplies them on args changes', () => {
    const tagName = nextTagName();
    class PropertyElement extends HTMLElement {
      set payload(value) {
        this.payloadValue = value;
        this.payloadUpdates = (this.payloadUpdates || 0) + 1;
      }

      set items(value) {
        this.itemsValue = value;
      }

      set onSelect(value) {
        this.onSelectValue = value;
      }
    }
    defineComponent(tagName, PropertyElement);

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
          children: 'ignored',
          key: 'ignored',
          ref: 'ignored',
        }),
      );
    });

    const element = container.querySelector(tagName);
    expect(element.payloadValue).toBe(payload);
    expect(element.itemsValue).toBe(items);
    expect(element.onSelectValue).toBe(onSelect);
    expect(element.key).toBeUndefined();

    const nextPayload = { label: 'Second' };
    act(() => {
      root.render(storyRender({ payload: nextPayload, items, onSelect }));
    });

    expect(container.querySelector(tagName)).toBe(element);
    expect(element.payloadValue).toBe(nextPayload);
    expect(element.payloadUpdates).toBe(2);
  });

  it('can apply args as attributes', () => {
    const tagName = nextTagName();
    class AttributeElement extends HTMLElement {}
    defineComponent(tagName, AttributeElement);

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
          hidden: null,
        }),
      );
    });

    const element = container.querySelector(tagName);
    expect(element.getAttribute('active')).toBe('');
    expect(element.getAttribute('count')).toBe('2');
    expect(element.getAttribute('detail')).toBe('[object Object]');
    expect(element.getAttribute('label')).toBe('Greeting');
    expect(element.hasAttribute('hidden')).toBe(false);

    act(() => {
      root.render(
        storyRender({
          active: false,
          count: 3,
          detail: undefined,
          label: null,
        }),
      );
    });

    expect(element.hasAttribute('active')).toBe(false);
    expect(element.getAttribute('count')).toBe('3');
    expect(element.hasAttribute('detail')).toBe(false);
    expect(element.hasAttribute('label')).toBe(false);
  });

  it('supports wrapper, className, and id options', () => {
    const tagName = nextTagName();
    class WrappedElement extends HTMLElement {}
    defineComponent(tagName, WrappedElement);

    const storyRender = renderWebComponent(tagName, {
      wrapper: 'section',
      className: 'web-component-story',
      id: 'web-component-fixture',
    });

    act(() => {
      root.render(storyRender({}));
    });

    const wrapper = container.querySelector('section');
    expect(wrapper.id).toBe('web-component-fixture');
    expect(wrapper.className).toBe('web-component-story');
    expect(wrapper.querySelector(tagName)).not.toBeNull();
  });

  it('remounts without redefining the custom element', () => {
    const tagName = nextTagName();
    class RemountElement extends HTMLElement {}
    class ReplacementElement extends HTMLElement {}
    defineComponent(tagName, RemountElement);

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

    expect(defineComponent(tagName, ReplacementElement)).toBe(RemountElement);
    expect(() => {
      act(() => {
        root.render(storyRender({ label: 'Second' }));
      });
    }).not.toThrow();
  });
});
