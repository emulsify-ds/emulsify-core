import { useEffect } from '@storybook/preview-api';
import Twig from 'twig';
import { setupTwig, fetchCSSFiles } from './utils.js';
import { getRules } from "axe-core";

// If in a Drupal project, it's recommended to import a symlinked version of drupal.js.
import './_drupal.js';

function enableRulesByTag(tags = []) {
  const allRules = getRules();
  return allRules.map(rule =>
    tags.some(t => rule.tags.includes(t)) ? { id: rule.ruleId, enabled: true } : { id: rule.ruleId, enabled: false }
  );
}

const AxeRules = enableRulesByTag([
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
]);

export const decorators = [
  (Story, { args }) => {
    const { renderAs } = args || {};

    // Usual emulsify hack to add Drupal behaviors.
    useEffect(() => {
      Drupal.attachBehaviors();
    }, [args]);
    return Story();
  },
];

setupTwig(Twig);
fetchCSSFiles();

export const parameters = {
  actions: { argTypesRegex: '^on[A-Z].*' },
  a11y: {
    config: {
      detailedReport: true,
      detailedReportOptions: {
        html: true,
      },
      rules: AxeRules,
    },
  },
};
