/**
 * @file Storybook preview configuration shared by Emulsify projects.
 */

import { getRules } from 'axe-core';
import React from 'react';
import { defaultDecorateStory, useEffect } from 'storybook/preview-api';
import Twig from 'twig';
import {
  mergePreviewParameters,
  normalizePreviewOverrideModule,
} from '../src/storybook/preview-parameters.js';
import {
  renderHtmlStoryResult,
  StoryHtmlBoundary,
  withLegacyStoryToString,
} from '../src/storybook/render-twig.js';
import {
  attachStorybookBehaviors,
  fetchCSSFiles,
  getStorybookPlatformAdapter,
  setupTwig,
} from './utils.js';

const previewOverrideModules = import.meta.glob(
  [
    // Installed package path: node_modules/@emulsify/core/.storybook -> project root.
    '../../../../config/emulsify-core/storybook/preview.js',
    // Local development path: repo .storybook -> repo root.
    '../config/emulsify-core/storybook/preview.js',
  ],
  { eager: true },
);
const [previewOverrideModule] = Object.values(previewOverrideModules);
const externalOverrides = normalizePreviewOverrideModule(previewOverrideModule);

const platformAdapter = getStorybookPlatformAdapter();
const platformBehaviorShimReady = platformAdapter.loadDrupalBehaviorShim
  ? import('./_drupal.js')
  : Promise.resolve();
const platformTwigExtensions = [];
if (platformAdapter.registerDrupalTwigFilters) {
  platformTwigExtensions.push((await import('twig-drupal-filters')).default);
}

/**
 * Filters accessibility rules by matching tags.
 * @param {string[]} [tags=[]] List of WCAG rule tags to enable.
 * @returns {{id: string, enabled: boolean}[]} Array of rule configurations.
 */
function enableRulesByTag(tags = []) {
  const allRules = getRules();
  return allRules.map((rule) =>
    tags.some((t) => rule.tags.includes(t))
      ? { id: rule.ruleId, enabled: true }
      : { id: rule.ruleId, enabled: false },
  );
}

/**
 * Precomputed Axe accessibility rules enabled by default.
 * @type {{id: string, enabled: boolean}[]}
 */
const AxeRules = enableRulesByTag([
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
]);

/**
 * Storybook React wraps story functions in React elements before decorators run.
 * Preserve that React-safe behavior while giving old stringifying decorators a
 * useful string result for legacy Twig stories.
 *
 * @param {Function} storyFn Storybook story function.
 * @param {Function[]} decorators Storybook decorators.
 * @returns {Function} Decorated story function.
 */
export const applyDecorators = (storyFn, decorators) =>
  defaultDecorateStory(
    (context) =>
      withLegacyStoryToString(React.createElement(storyFn, context), () =>
        storyFn(context),
      ),
    decorators,
  );

/**
 * Storybook decorators to apply platform-specific behavior after each story render.
 * @type {Array<import('@storybook/react').Decorator>}
 */
export const decorators = [
  /**
   * Decorator that attaches platform behavior on story mount and args updates.
   * Legacy Twig stories that return HTML strings are wrapped so React
   * Storybook renders them as markup while projects migrate to renderTwig().
   *
   * @param {Function} Story The story component to render.
   * @param {object} context Story context including args.
   * @returns {*} Rendered story.
   */
  (Story, { args }) => {
    useEffect(() => {
      void attachStorybookBehaviors({
        adapter: platformAdapter,
        behaviorShimReady: platformBehaviorShimReady,
      });
    }, [args]);

    return React.createElement(
      StoryHtmlBoundary,
      {},
      renderHtmlStoryResult(Story(), {
        platformAdapter,
      }),
    );
  },
];

/**
 * Default Storybook parameters before applying overrides.
 * @type {object}
 */
const defaultParams = {
  actions: { argTypesRegex: '^on[A-Z].*' },
  a11y: {
    config: {
      detailedReport: true,
      detailedReportOptions: { html: true },
      rules: AxeRules,
    },
  },
  layout: 'fullscreen',
};

/**
 * Merged Storybook parameters including external overrides.
 * @type {object}
 */
export const parameters = mergePreviewParameters(
  defaultParams,
  externalOverrides,
);

// Initialize platform-agnostic Twig helpers and eager-load story CSS.
setupTwig(Twig, { extensions: platformTwigExtensions });
await fetchCSSFiles(parameters);
