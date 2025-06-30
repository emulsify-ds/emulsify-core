// .storybook/preview.js
import { getRules } from 'axe-core';
import { useEffect } from 'storybook/preview-api';
import Twig from 'twig';
import { fetchCSSFiles, setupTwig } from './utils.js';

/**
 * External override parameters loaded from project config file, if present.
 * @type {object}
 */
let externalOverrides = {};

// Load the preview.js from the project config overrides.
try {
  /**
   * Dynamically require external preview overrides.
   * @module '../../../../config/emulsify-core/storybook/preview.js'
   */
  externalOverrides = require(
    '../../../../config/emulsify-core/storybook/preview.js'
  ).default;
} catch (err) {
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
  return allRules.map(rule =>
    tags.some(t => rule.tags.includes(t))
      ? { id: rule.ruleId, enabled: true }
      : { id: rule.ruleId, enabled: false }
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

// Initialize Twig and load any CSS that your stories need.
setupTwig(Twig);
fetchCSSFiles();

/**
 * Storybook decorators to apply Drupal behaviors before rendering each story.
 * @type {Array<import('@storybook/react').Decorator>}
 */
export const decorators = [
  /**
   * Decorator that attaches Drupal behaviors on story mount.
   * @param {Function} Story The story component to render.
   * @param {object} context Story context including args.
   * @returns {Function} Rendered story.
   */
  (Story, { args }) => {
    useEffect(() => {
      Drupal.attachBehaviors();
    }, [args]);
    return Story();
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
export const parameters = {
  ...defaultParams,
  ...externalOverrides,
};
