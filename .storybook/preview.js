import { useEffect } from '@storybook/preview-api';
import Twig from 'twig';
import { setupTwig } from './setupTwig';
import { overrideParams } from '../../../../config/emulsify-core/storybook/preview';

// If in a Drupal project, it's recommended to import a symlinked version of drupal.js.
import './_drupal.js';

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

const safeParamOverrides = overrideParams || {};

export const parameters = {
  actions: { argTypesRegex: '^on[A-Z].*' },
  ...safeParamOverrides,
};
