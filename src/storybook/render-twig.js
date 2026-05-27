/**
 * @file React Storybook renderer for imported Twig template modules.
 */

import React, { useEffect, useReducer, useRef } from 'react';
import {
  attachStorybookBehaviors,
  normalizeStorybookPlatformAdapter,
} from './platform-behaviors.js';
import { TWIG_SOURCE_LOADED_EVENT } from './twig/source-events.js';

/**
 * Read the normalized Emulsify environment injected by Storybook's Vite config.
 *
 * @returns {object} Injected Emulsify environment, when present.
 */
function getInjectedEnvironment() {
  return globalThis.__EMULSIFY_ENV__ || {};
}

/**
 * Normalize either a full platform adapter or the storybook adapter subset.
 *
 * @param {object} [adapter] - Candidate platform adapter.
 * @returns {object} Storybook adapter flags.
 */
export function getActiveStorybookAdapter(options = {}) {
  const adapter =
    options.platformAdapter || getInjectedEnvironment().platformAdapter;
  return normalizeStorybookPlatformAdapter(adapter?.storybook || adapter);
}

/**
 * Build Twig context from Storybook args and optional static defaults.
 *
 * @param {object} [args={}] - Storybook args.
 * @param {{ context?: object|Function }} [options={}] - Render options.
 * @param {object} [storyContext={}] - Storybook story context.
 * @returns {object} Twig render context.
 */
function buildTwigContext(args = {}, options = {}, storyContext = {}) {
  if (typeof options.context === 'function') {
    return options.context(args, storyContext) || {};
  }

  return {
    ...(options.context || {}),
    ...(args || {}),
  };
}

/**
 * Check whether a string looks like rendered HTML markup.
 *
 * @param {*} value - Candidate story result.
 * @returns {boolean} TRUE when the value appears to be an HTML string.
 */
function isLikelyHtmlString(value) {
  return (
    typeof value === 'string' &&
    /^\s*<(?:!doctype|!--|[a-z][\w:-]*)(?:\s|>|\/)/i.test(value)
  );
}

/**
 * Give Storybook's React element wrapper a useful string representation.
 *
 * Some legacy stories include decorators like `(story) => `${story()}``.
 * Storybook React now passes those decorators a React element, which normally
 * stringifies to `[object Object]`. This preserves the old behavior for Twig
 * string stories while leaving the element renderable by React.
 *
 * @param {*} result - Candidate React story element.
 * @param {Function} getStoryResult - Function returning the raw story result.
 * @returns {*} Original or cloned story result.
 */
export function withLegacyStoryToString(result, getStoryResult) {
  if (!React.isValidElement(result) || typeof getStoryResult !== 'function') {
    return result;
  }

  const element = { ...result };
  Object.defineProperty(element, 'toString', {
    value: () => {
      try {
        const storyResult = getStoryResult();
        return storyResult == null ? '' : String(storyResult);
      } catch {
        return Object.prototype.toString.call(result);
      }
    },
  });

  return element;
}

/**
 * Extract legacy Twig HTML from a React story element with a custom toString.
 *
 * @param {*} reactElement - Candidate React story element.
 * @returns {string|undefined} Legacy HTML string when detected.
 */
export function legacyStringFromElement(reactElement) {
  if (!React.isValidElement(reactElement)) {
    return undefined;
  }
  if (reactElement.toString === Object.prototype.toString) {
    return undefined;
  }

  try {
    const stringified = String(reactElement);
    if (stringified === '[object Object]') {
      return undefined;
    }
    if (typeof stringified !== 'string') {
      return undefined;
    }
    if (!isLikelyHtmlString(stringified)) {
      return undefined;
    }
    return stringified;
  } catch {
    return undefined;
  }
}

/**
 * Render an imported Twig module into an HTML string.
 *
 * @param {Function} template - Twig render function.
 * @param {object} [args={}] - Storybook args.
 * @param {object} [options={}] - Render options.
 * @param {object} [storyContext={}] - Storybook story context.
 * @returns {string} Rendered HTML.
 */
export function renderTwigToHtml(
  template,
  args = {},
  options = {},
  storyContext = {},
) {
  if (typeof template !== 'function') {
    return '';
  }

  try {
    const html = template(buildTwigContext(args, options, storyContext));
    return html == null ? '' : String(html);
  } catch (error) {
    return `An error occurred whilst rendering Twig story: ${
      error?.message || error
    }`;
  }
}

/**
 * React component that renders an HTML string into a stable wrapper element.
 *
 * @param {object} props - Component props.
 * @param {string} [props.html] - Rendered HTML string.
 * @param {object} [props.options] - Render options.
 * @returns {React.ReactElement} React element.
 */
export function TwigHtmlStory({ html = '', options = {} }) {
  const wrapperRef = useRef(null);
  const adapter = getActiveStorybookAdapter(options);
  const Wrapper = options.wrapper || 'div';

  useEffect(() => {
    void attachStorybookBehaviors({
      adapter,
      context: wrapperRef.current,
    });
  }, [adapter.attachDrupalBehaviors, html]);

  return React.createElement(Wrapper, {
    ref: wrapperRef,
    id: options.id,
    className: options.className,
    'data-emulsify-twig-story': '',
    dangerouslySetInnerHTML: { __html: html },
  });
}

/**
 * React component that renders Twig HTML into a stable wrapper element.
 *
 * @param {object} props - Component props.
 * @param {Function} props.template - Twig render function.
 * @param {object} [props.args] - Storybook args.
 * @param {object} [props.options] - Render options.
 * @param {object} [props.storyContext] - Storybook story context.
 * @returns {React.ReactElement} React element.
 */
export function TwigStory({
  template,
  args = {},
  options = {},
  storyContext = {},
}) {
  const [, rerender] = useReducer((version) => version + 1, 0);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    window.addEventListener(TWIG_SOURCE_LOADED_EVENT, rerender);
    return () => {
      window.removeEventListener(TWIG_SOURCE_LOADED_EVENT, rerender);
    };
  }, []);

  return React.createElement(TwigHtmlStory, {
    html: renderTwigToHtml(template, args, options, storyContext),
    options,
  });
}

/**
 * Render a raw HTML string through the same wrapper used by Twig stories.
 *
 * This supports legacy Storybook stories that return Twig HTML strings
 * directly while projects migrate to `renderTwig()`.
 *
 * @param {string} html - Rendered HTML.
 * @param {object} [options={}] - Render options.
 * @returns {React.ReactElement} React element.
 */
export function renderTwigHtml(html, options = {}) {
  return React.createElement(TwigHtmlStory, {
    html: html == null ? '' : String(html),
    options,
  });
}

/**
 * Convert legacy string-returning Storybook results into React elements.
 *
 * React stories and other non-string results pass through unchanged.
 *
 * @param {*} result - Story render result.
 * @param {object} [options={}] - Render options for string results.
 * @returns {*} React element for strings, otherwise the original result.
 */
export function renderHtmlStoryResult(result, options = {}) {
  if (typeof result === 'string') {
    return renderTwigHtml(result, options);
  }

  const legacyHtml = legacyStringFromElement(result);
  if (typeof legacyHtml === 'string') {
    return renderTwigHtml(legacyHtml, options);
  }

  return result;
}

/**
 * Create a React-compatible Storybook render function for a Twig template.
 *
 * @param {Function} template - Imported Twig module render function.
 * @param {object} [options={}] - Render options.
 * @returns {Function} Storybook render function.
 */
export function renderTwig(template, options = {}) {
  const EmulsifyTwigStoryRender = (args = {}, storyContext = {}) =>
    React.createElement(TwigStory, {
      template,
      args,
      options,
      storyContext,
    });

  EmulsifyTwigStoryRender.displayName = 'EmulsifyTwigStoryRender';

  return EmulsifyTwigStoryRender;
}
