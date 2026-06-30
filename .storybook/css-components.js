/**
 * @file Storybook mirrored component CSS side-effect loader.
 *
 * Drupal projects load component CSS from the mirrored root components tree,
 * but shared/global Storybook CSS still lives under dist. Exclude
 * dist/components so the mirrored component CSS is not loaded twice.
 */

import 'virtual:emulsify-storybook-css/shared-dist';

import.meta.glob('../../../../components/**/*.css', { eager: true });
