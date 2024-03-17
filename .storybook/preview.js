import { useEffect } from '@storybook/client-api';
import Twig from 'twig';
import { setupTwig } from './setupTwig';

// GLOBAL CSS
(async () => {
  let compiled;
  try {
    compiled = await import('../../../dist/css/style.css');
  } catch (e) {}
})();

// Custom theme preview config if it exists.
(async () => {
  let preview;
  try {
    preview = await import('../../../config/emulsify-core/storybook/preview');
  } catch (e) {}
})();

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

export const parameters = {
  actions: { argTypesRegex: '^on[A-Z].*' },
};
