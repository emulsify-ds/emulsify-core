/**
 * @file React Storybook renderer for vanilla custom elements.
 */

import React, { useLayoutEffect, useRef } from 'react';

const reservedReactProps = new Set(['children', 'key', 'ref']);

/**
 * Validate a custom element tag name.
 *
 * @param {string} tagName - Candidate custom element tag name.
 * @returns {void}
 */
function assertValidTagName(tagName) {
  if (
    typeof tagName !== 'string' ||
    !tagName.includes('-') ||
    tagName !== tagName.toLowerCase()
  ) {
    throw new Error(
      `Invalid web component tag name "${String(
        tagName,
      )}". Custom element names must be lowercase and contain a hyphen.`,
    );
  }
}

/**
 * Define a custom element once, returning the registered element class.
 *
 * The browser custom element registry is permanent. Returning an existing
 * definition keeps Storybook HMR and repeated story evaluation from throwing.
 *
 * @param {string} tagName - Custom element tag name.
 * @param {CustomElementConstructor} ElementClass - Element class to register.
 * @param {ElementDefinitionOptions} [options] - Native customElements options.
 * @returns {CustomElementConstructor} Registered element class.
 */
export function defineComponent(tagName, ElementClass, options) {
  assertValidTagName(tagName);

  const ExistingElement = customElements.get(tagName);
  if (ExistingElement) {
    return ExistingElement;
  }

  customElements.define(tagName, ElementClass, options);
  return ElementClass;
}

/**
 * Return Storybook args without React-reserved props.
 *
 * @param {object} [args={}] - Storybook args.
 * @returns {Array<[string, *]>} Entries safe to apply to a custom element.
 */
function webComponentArgEntries(args = {}) {
  return Object.entries(args || {}).filter(
    ([key]) => !reservedReactProps.has(key),
  );
}

/**
 * Apply Storybook args as DOM properties.
 *
 * @param {HTMLElement} element - Custom element instance.
 * @param {object} args - Storybook args.
 * @returns {void}
 */
function applyProperties(element, args) {
  for (const [key, value] of webComponentArgEntries(args)) {
    element[key] = value;
  }
}

/**
 * Apply Storybook args as DOM attributes.
 *
 * @param {HTMLElement} element - Custom element instance.
 * @param {object} args - Storybook args.
 * @returns {void}
 */
function applyAttributes(element, args) {
  for (const [key, value] of webComponentArgEntries(args)) {
    if (value === false || value == null) {
      element.removeAttribute(key);
      continue;
    }

    element.setAttribute(key, value === true ? '' : String(value));
  }
}

/**
 * React wrapper that applies Storybook args to a custom element via ref.
 *
 * @param {object} props - Component props.
 * @param {string} props.tagName - Custom element tag name.
 * @param {object} [props.args] - Storybook args.
 * @param {object} [props.options] - Render options.
 * @returns {React.ReactElement} React element.
 */
function WebComponentStory({ tagName, args = {}, options = {} }) {
  const elementRef = useRef(null);
  const WrapperElement = options.wrapper;
  const argsAs = options.argsAs || 'properties';
  const elementProps = { ref: elementRef };

  if (!WrapperElement) {
    elementProps.id = options.id;
    elementProps.className = options.className;
  }

  useLayoutEffect(() => {
    if (!elementRef.current) return;

    if (argsAs === 'attributes') {
      applyAttributes(elementRef.current, args);
      return;
    }

    applyProperties(elementRef.current, args);
  });

  const element = React.createElement(tagName, elementProps);

  if (!WrapperElement) {
    return element;
  }

  return React.createElement(
    WrapperElement,
    {
      id: options.id,
      className: options.className,
    },
    element,
  );
}

WebComponentStory.displayName = 'WebComponentStory';

/**
 * Create a React-compatible Storybook render function for a custom element.
 *
 * @param {string} tagName - Custom element tag name.
 * @param {object} [options={}] - Render options.
 * @param {'properties'|'attributes'} [options.argsAs='properties'] - How args are applied.
 * @param {string|Function} [options.wrapper] - Optional wrapper element.
 * @param {string} [options.className] - Class for the wrapper or element.
 * @param {string} [options.id] - ID for the wrapper or element.
 * @returns {Function} Storybook render function.
 */
export function renderWebComponent(tagName, options = {}) {
  assertValidTagName(tagName);

  const EmulsifyWebComponentRender = (args = {}, storyContext = {}) =>
    React.createElement(WebComponentStory, {
      tagName,
      args,
      options,
      storyContext,
    });

  EmulsifyWebComponentRender.displayName = 'EmulsifyWebComponentRender';

  return EmulsifyWebComponentRender;
}
