/**
 * @file React Storybook renderer for vanilla custom elements.
 */

import React, { useLayoutEffect, useRef } from 'react';

const reservedReactProps = new Set(['children', 'key', 'ref']);
const supportedArgsModes = ['properties', 'attributes'];
const reservedCustomElementNames = new Set([
  'annotation-xml',
  'color-profile',
  'font-face',
  'font-face-src',
  'font-face-uri',
  'font-face-format',
  'font-face-name',
  'missing-glyph',
]);
const validCustomElementNameCharacterPattern =
  /^[-.0-9_a-z\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}]*$/u;

/**
 * Validate a custom element tag name.
 *
 * @param {string} tagName - Candidate custom element tag name.
 * @returns {void}
 */
function assertValidTagName(tagName) {
  if (
    typeof tagName !== 'string' ||
    !/^[a-z]/u.test(tagName) ||
    !validCustomElementNameCharacterPattern.test(tagName.slice(1)) ||
    !tagName.includes('-') ||
    reservedCustomElementNames.has(tagName)
  ) {
    throw new SyntaxError(
      `Invalid custom element tag name "${String(
        tagName,
      )}". Names must start with an ASCII lowercase letter, contain a hyphen, use browser-supported custom-element name characters, and must not be a reserved name.`,
    );
  }
}

/**
 * Validate that a value can be registered as a custom element.
 *
 * Reflect.construct checks whether the value is constructable without invoking
 * user code. The prototype check catches classes that cannot be used as
 * HTMLElement implementations before the native registry is mutated.
 *
 * @param {*} ElementClass - Candidate custom element constructor.
 * @returns {void}
 */
function assertCustomElementConstructor(ElementClass) {
  let isConstructor = false;

  if (typeof ElementClass === 'function') {
    try {
      Reflect.construct(Object, [], ElementClass);
      isConstructor = true;
    } catch {
      // The native registry requires an actual constructor.
    }
  }

  let inheritsFromHTMLElement = false;
  if (isConstructor) {
    try {
      inheritsFromHTMLElement = HTMLElement.prototype.isPrototypeOf(
        ElementClass.prototype,
      );
    } catch {
      // Proxies and accessor-backed prototypes can fail this structural check.
    }
  }

  if (!isConstructor || !inheritsFromHTMLElement) {
    throw new TypeError(
      'Invalid custom element constructor. Expected a constructable class whose prototype inherits from HTMLElement.',
    );
  }

  for (
    let SuperClass = Object.getPrototypeOf(ElementClass);
    SuperClass && SuperClass !== HTMLElement;
    SuperClass = Object.getPrototypeOf(SuperClass)
  ) {
    const isNativeHtmlElementInterface =
      /^HTML.*Element$/u.test(SuperClass.name || '') &&
      globalThis[SuperClass.name] === SuperClass;

    if (isNativeHtmlElementInterface) {
      throw new TypeError(
        `Invalid custom element constructor. Autonomous custom elements must extend HTMLElement rather than ${SuperClass.name}. Customized built-in elements are not supported.`,
      );
    }
  }
}

/**
 * Reject customized built-in registration options the renderer cannot create.
 *
 * @param {ElementDefinitionOptions} [options] - Native registry options.
 * @returns {void}
 */
function assertAutonomousElementOptions(options) {
  if (options?.extends !== undefined) {
    throw new TypeError(
      'Invalid defineCustomElement option "extends". Customized built-in elements are not supported; register an autonomous custom element instead.',
    );
  }
}

/**
 * Return a useful name for a custom element constructor.
 *
 * @param {Function} ElementClass - Custom element constructor.
 * @returns {string} Constructor name.
 */
function getConstructorName(ElementClass) {
  return ElementClass.name || '(anonymous constructor)';
}

/**
 * Define a custom element once, returning the registered constructor.
 *
 * The browser custom element registry is permanent. Returning an existing
 * definition keeps Storybook HMR and repeated story evaluation from throwing.
 *
 * @param {string} tagName - Custom element tag name.
 * @param {CustomElementConstructor} ElementClass - Element class to register.
 * @param {ElementDefinitionOptions} [options] - Native options; `extends` is unsupported.
 * @returns {CustomElementConstructor} Registered element class.
 */
export function defineCustomElement(tagName, ElementClass, options) {
  assertValidTagName(tagName);
  assertCustomElementConstructor(ElementClass);
  assertAutonomousElementOptions(options);

  const ExistingElement = customElements.get(tagName);
  if (ExistingElement) {
    if (ExistingElement !== ElementClass) {
      console.warn(
        `Custom element "${tagName}" is already defined with ${getConstructorName(
          ExistingElement,
        )}; ${getConstructorName(
          ElementClass,
        )} was not registered. Reload Storybook to use the new constructor.`,
      );
    }

    return ExistingElement;
  }

  customElements.define(tagName, ElementClass, options);
  return ElementClass;
}

/**
 * Validate and normalize render options.
 *
 * @param {object} options - Candidate renderer options.
 * @returns {object} Normalized renderer options.
 */
function normalizeRenderOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Invalid renderWebComponent options. Expected an options object.',
    );
  }

  const argsAs = options.argsAs === undefined ? 'properties' : options.argsAs;
  if (!supportedArgsModes.includes(argsAs)) {
    throw new TypeError(
      `Invalid renderWebComponent option "argsAs": "${String(
        argsAs,
      )}". Expected "properties" or "attributes".`,
    );
  }

  const events = normalizeEventMappings(options.events);

  return {
    argsAs,
    className: options.className,
    events,
    eventArgNames: new Set(events.map(([, argName]) => argName)),
    id: options.id,
    wrapper: options.wrapper,
  };
}

/**
 * Validate and normalize native event-to-arg mappings.
 *
 * @param {object} [events] - Native event names mapped to callback arg names.
 * @returns {Array<[string, string]>} Normalized mappings.
 */
function normalizeEventMappings(events) {
  if (events === undefined) {
    return [];
  }

  if (!events || typeof events !== 'object' || Array.isArray(events)) {
    throw new TypeError(
      'Invalid renderWebComponent option "events". Expected an object mapping native event names to Storybook callback arg names.',
    );
  }

  return Object.entries(events).map(([eventName, argName]) => {
    if (!eventName.trim()) {
      throw new TypeError(
        'Invalid renderWebComponent option "events": event names must be non-empty strings.',
      );
    }

    if (typeof argName !== 'string' || !argName.trim()) {
      throw new TypeError(
        `Invalid renderWebComponent option "events.${eventName}". Expected a non-empty Storybook callback arg name.`,
      );
    }

    return [eventName, argName];
  });
}

/**
 * Return Storybook args without React- or renderer-owned values.
 *
 * @param {object} [args={}] - Storybook args.
 * @param {Set<string>} [eventArgNames] - Callback args owned by event mappings.
 * @returns {Array<[string, *]>} Entries safe to apply to a custom element.
 */
function customElementArgEntries(args = {}, eventArgNames = new Set()) {
  return Object.entries(args || {}).filter(
    ([key]) => !reservedReactProps.has(key) && !eventArgNames.has(key),
  );
}

/**
 * Apply Storybook args as DOM properties.
 *
 * @param {HTMLElement} element - Custom element instance.
 * @param {Array<[string, *]>} entries - Storybook arg entries.
 * @returns {void}
 */
function applyProperties(element, entries) {
  for (const [key, value] of entries) {
    element[key] = value;
  }
}

/**
 * Apply Storybook args as DOM attributes.
 *
 * @param {HTMLElement} element - Custom element instance.
 * @param {Array<[string, *]>} entries - Storybook arg entries.
 * @returns {void}
 */
function applyAttributes(element, entries) {
  for (const [key, value] of entries) {
    if (value === false || value == null) {
      element.removeAttribute(key);
      continue;
    }

    element.setAttribute(key, value === true ? '' : String(value));
  }
}

/**
 * Clear an arg that was applied during the previous render.
 *
 * Assigning undefined in property mode lets custom setters clear their own
 * state. Reflected DOM string properties need their generated attribute
 * removed as well so values such as "undefined" do not remain visible.
 *
 * @param {HTMLElement} element - Custom element instance.
 * @param {string} key - Previously applied arg name.
 * @param {'properties'|'attributes'} argsAs - Previous application mode.
 * @returns {void}
 */
function clearAppliedArg(element, key, argsAs) {
  if (argsAs === 'attributes') {
    element.removeAttribute(key);
    return;
  }

  element[key] = undefined;

  if (key === 'className') {
    element.removeAttribute('class');
  } else if (element.getAttribute(key) === 'undefined') {
    element.removeAttribute(key);
  }
}

/**
 * Resolve active native event listeners from the current Storybook args.
 *
 * @param {object} args - Storybook args.
 * @param {Array<[string, string]>} mappings - Event-to-callback mappings.
 * @returns {Array<[string, Function]>} Native listeners to attach.
 */
function resolveEventListeners(args, mappings) {
  return mappings.flatMap(([eventName, argName]) => {
    const callback = args[argName];

    if (callback == null) {
      return [];
    }

    if (typeof callback !== 'function') {
      throw new TypeError(
        `Invalid Storybook arg "${argName}" for native event "${eventName}". Expected a function, null, or undefined.`,
      );
    }

    return [[eventName, callback]];
  });
}

/**
 * Restore element-level presentation options after Storybook args are applied.
 *
 * Storybook args win while present. When an overriding arg is later omitted,
 * the stable renderer option is restored because React may not write an
 * unchanged virtual prop again.
 *
 * @param {HTMLElement} element - Custom element instance.
 * @param {Set<string>} currentKeys - Args applied during this render.
 * @param {object} options - Normalized render options.
 * @returns {void}
 */
function restoreElementOptions(element, currentKeys, options) {
  if (options.id != null && !currentKeys.has('id')) {
    element.id = options.id;
  }

  const classArg = options.argsAs === 'attributes' ? 'class' : 'className';
  if (options.className != null && !currentKeys.has(classArg)) {
    element.className = options.className;
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
function CustomElementStory({ tagName, args = {}, options }) {
  const elementRef = useRef(null);
  const previousAppliedArgs = useRef({
    argsAs: options.argsAs,
    keys: new Set(),
  });
  const WrapperElement = options.wrapper;
  const storyArgs = args && typeof args === 'object' ? args : {};
  const entries = customElementArgEntries(storyArgs, options.eventArgNames);
  const currentKeys = new Set(entries.map(([key]) => key));
  const eventListeners = resolveEventListeners(storyArgs, options.events);
  const elementProps = { ref: elementRef };

  if (!WrapperElement) {
    elementProps.id = options.id;
    elementProps.className = options.className;
  }

  useLayoutEffect(() => {
    if (!elementRef.current) return;

    const element = elementRef.current;
    const previous = previousAppliedArgs.current;

    for (const key of previous.keys) {
      if (previous.argsAs !== options.argsAs || !currentKeys.has(key)) {
        clearAppliedArg(element, key, previous.argsAs);
      }
    }

    for (const [eventName, callback] of eventListeners) {
      element.addEventListener(eventName, callback);
    }

    if (options.argsAs === 'attributes') {
      applyAttributes(element, entries);
    } else {
      applyProperties(element, entries);
    }

    if (!WrapperElement) {
      restoreElementOptions(element, currentKeys, options);
    }

    previousAppliedArgs.current = {
      argsAs: options.argsAs,
      keys: currentKeys,
    };

    return () => {
      for (const [eventName, callback] of eventListeners) {
        element.removeEventListener(eventName, callback);
      }
    };
  });

  const element = React.createElement(
    tagName,
    elementProps,
    storyArgs.children,
  );

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

CustomElementStory.displayName = 'CustomElementStory';

/**
 * Create a React-compatible Storybook render function for a custom element.
 *
 * @param {string} tagName - Custom element tag name.
 * @param {object} [options={}] - Render options.
 * @param {'properties'|'attributes'} [options.argsAs='properties'] - How args are applied.
 * @param {Record<string, string>} [options.events] - Native event names mapped to callback args.
 * @param {string|Function} [options.wrapper] - Optional wrapper element.
 * @param {string} [options.className] - Class for the wrapper or element.
 * @param {string} [options.id] - ID for the wrapper or element.
 * @returns {Function} Storybook render function.
 */
export function renderWebComponent(tagName, options = {}) {
  assertValidTagName(tagName);
  const normalizedOptions = normalizeRenderOptions(options);

  const EmulsifyWebComponentRender = (args = {}) =>
    React.createElement(CustomElementStory, {
      tagName,
      args,
      options: normalizedOptions,
    });

  EmulsifyWebComponentRender.displayName = 'EmulsifyWebComponentRender';

  return EmulsifyWebComponentRender;
}
