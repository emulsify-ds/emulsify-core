/**
 * @file React Storybook renderer for imported Twig template modules.
 */

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import {
  attachStorybookBehaviors,
  normalizeStorybookPlatformAdapter,
} from './platform-behaviors.js';

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
 * Convert a wrapper containing one raw HTML text node into real DOM markup.
 *
 * Storybook React may render string-returning legacy Twig stories as escaped
 * text before decorators can inspect the string. This keeps those stories
 * working without changing how normal React stories render.
 *
 * @param {HTMLElement} wrapper - Story wrapper element.
 * @returns {boolean} TRUE when raw HTML text was converted.
 */
export function normalizeHtmlTextStory(wrapper) {
  if (!wrapper || wrapper.childNodes.length !== 1) {
    return false;
  }

  const [onlyChild] = wrapper.childNodes;
  if (onlyChild.nodeType !== Node.TEXT_NODE) {
    return false;
  }

  const html = onlyChild.textContent || '';
  if (!isLikelyHtmlString(html)) {
    return false;
  }

  wrapper.innerHTML = html;
  wrapper.setAttribute('data-emulsify-twig-story', '');
  return true;
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
 * Boundary that repairs legacy string-returning stories rendered as React text.
 *
 * @param {object} props - Component props.
 * @param {*} props.children - Rendered Storybook story result.
 * @returns {React.ReactElement} React element.
 */
export function StoryHtmlBoundary({ children }) {
  const wrapperRef = useRef(null);

  useLayoutEffect(() => {
    normalizeHtmlTextStory(wrapperRef.current);
  }, [children]);

  return React.createElement(
    'div',
    {
      ref: wrapperRef,
      'data-emulsify-story-boundary': '',
      style: { display: 'contents' },
    },
    children,
  );
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
  return typeof result === 'string' ? renderTwigHtml(result, options) : result;
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
