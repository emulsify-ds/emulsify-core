/**
 * @file Shared helpers for Storybook preview decorator wiring.
 */

import React from 'react';
import {
  renderHtmlStoryResult,
  withLegacyStoryToString,
} from './render-twig.js';

/**
 * Render a Storybook story function as a React element with full context props.
 *
 * @param {Function} storyFn - Storybook story function.
 * @param {object} context - Full Storybook story context.
 * @returns {React.ReactElement} React story element.
 */
export function createStoryElement(storyFn, context) {
  return withLegacyStoryToString(React.createElement(storyFn, context), () =>
    storyFn(context),
  );
}

/**
 * Apply Storybook decorators while preserving full story context.
 *
 * @param {Function} decorateStory - Storybook decorator applier.
 * @param {Function} storyFn - Storybook story function.
 * @param {Function[]} decorators - Storybook decorators.
 * @returns {Function} Decorated story function.
 */
export const applyStoryDecorators = (decorateStory, storyFn, decorators) =>
  decorateStory((context) => createStoryElement(storyFn, context), decorators);

/**
 * Render a preview Story callback through Emulsify's HTML compatibility layer.
 *
 * @param {Function} Story - Decorated Storybook story callback.
 * @param {object} context - Full Storybook story context.
 * @param {object} [options={}] - Render options.
 * @returns {*} Rendered Storybook story result.
 */
export function renderPreviewStory(Story, context, options = {}) {
  return renderHtmlStoryResult(Story(context), options);
}
