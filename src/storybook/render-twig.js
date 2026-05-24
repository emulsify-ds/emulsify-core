/**
 * @file React Storybook renderer for imported Twig template modules.
 */

import React, { useEffect, useRef } from 'react';
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
  const wrapperRef = useRef(null);
  const html = renderTwigToHtml(template, args, options, storyContext);
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
