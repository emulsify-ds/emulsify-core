import { useEffect } from '@storybook/preview-api';
import Twig from 'twig';
import { setupTwig, fetchCSSFiles } from './utils.js';
import { getRules } from 'axe-core';
import overrideParams from '../../../../config/emulsify-core/storybook/preview.js';

// If in a Drupal project, it's recommended to import a symlinked version of drupal.js.
import './_drupal.js';

/**
 * Enable only the a11y rules matching one of the given tags.
 */
function enableRulesByTag(tags = []) {
  const allRules = getRules();
  return allRules.map(rule =>
    tags.some(t => rule.tags.includes(t))
      ? { id: rule.ruleId, enabled: true }
      : { id: rule.ruleId, enabled: false }
  );
}

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

// Decorators are picked up via the named export.
export const decorators = [
  (Story, { args }) => {
    useEffect(() => {
      Drupal.attachBehaviors();
    }, [args]);
    return Story();
  },
];

// Parameters are also a named export, with your external overrides merged in.
export const parameters = {
  actions: { argTypesRegex: '^on[A-Z].*' },
  a11y: {
    config: {
      detailedReport: true,
      detailedReportOptions: { html: true },
      rules: AxeRules,
    },
  },
  // Merge in your imported storySort config (or any other overrides).
  ...overrideParams,
};
