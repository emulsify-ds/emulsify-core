// .storybook/preview.js
import { useEffect } from 'storybook/preview-api';
import Twig from 'twig';
import { setupTwig, fetchCSSFiles } from './utils.js';
import { getRules } from 'axe-core';

/**
 * External override parameters loaded from project config file, if present.
 * @type {object}
 */
let externalOverrides;

// Load the preview.js from the project config overrides.
try {
  /**
   * Dynamically require external preview overrides.
   * @module '../../../../config/emulsify-core/storybook/preview.js'
   */
  externalOverrides =
    require('../../../../config/emulsify-core/storybook/preview.js').default;
} catch {
  // no override file? swallow the error and use {}
  externalOverrides = {};
}

// Import Drupal behaviors for rich JavaScript integration.
import './_drupal.js';

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
 * Cache of rendered story output keyed by story id.
 * Storybook server renderer calls `storyFn()` before `fetchStoryHtml`, so
 * decorators can stash markup here and fetch can read it without re-rendering.
 *
 * @type {Map<string, unknown>}
 */
const renderedStoryCache = new Map();

/**
 * Converts a rendered story return value into an HTML string.
 *
 * @param {unknown} rendered
 *   The rendered story result.
 *
 * @returns {string}
 *   Normalized HTML string.
 */
function toHtmlString(rendered) {
  if (typeof rendered === 'string') {
    return rendered;
  }

  if (rendered && typeof rendered === 'object') {
    if (typeof rendered.outerHTML === 'string') {
      return rendered.outerHTML;
    }
    if (typeof rendered.html === 'string') {
      return rendered.html;
    }
  }

  return '';
}

/**
 * Default server renderer adapter for Storybook 9 server-webpack5.
 * Falls back to local story functions so projects do not need a remote
 * `parameters.server.url` endpoint for basic HTML/Twig stories.
 *
 * @param {string} _url
 *   Unused URL from server parameters.
 * @param {string} _path
 *   Unused story path/id from server parameters.
 * @param {object} _params
 *   Unused merged server params.
 * @param {object} storyContext
 *   Story context from Storybook.
 *
 * @returns {Promise<string>}
 *   Story markup as an HTML string.
 */
async function fetchStoryHtmlFromStoryContext(
  _url,
  _path,
  _params,
  storyContext,
) {
  const storyId = storyContext?.id || _path;
  if (!storyId || !renderedStoryCache.has(storyId)) {
    return '';
  }

  const rendered = await Promise.resolve(renderedStoryCache.get(storyId));
  return toHtmlString(rendered);
}

// Initialize Twig and load any CSS that your stories need.
setupTwig(Twig);
fetchCSSFiles();

/**
 * Storybook decorators to apply Drupal behaviors before rendering each story.
 * The HTML renderer still uses the generic Storybook decorator signature.
 * @type {Function[]}
 */
export const decorators = [
  /**
   * Decorator that attaches Drupal behaviors on story mount.
   * @param {Function} Story The story component to render.
   * @param {object} context Story context including args.
   * @returns {Function} Rendered story.
   */
  (Story, context) => {
    const { args, id } = context;
    useEffect(() => {
      Drupal.attachBehaviors();
    }, [args]);

    const rendered = Story();
    if (id) {
      renderedStoryCache.set(id, rendered);
    }
    return rendered;
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
  server: {
    url: '',
    fetchStoryHtml: fetchStoryHtmlFromStoryContext,
    params: {},
  },
};

/**
 * Merged Storybook parameters including external overrides.
 * @type {object}
 */
export const parameters = {
  ...defaultParams,
  ...externalOverrides,
};
