import { useEffect } from '@storybook/preview-api';
import Twig from 'twig';
import { setupTwig } from './setupTwig';

try {
  // Dynamically importing CSS files from the dist folder for Storybook preview.js.
  const requireCSS = require.context("../../../../dist", true, /\.css$/);
  requireCSS.keys().forEach(requireCSS);
} catch (error) {
  console.warn(
    'Warning: CSS files could not be loaded. The "dist" folder might be missing.',
  );
}

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
