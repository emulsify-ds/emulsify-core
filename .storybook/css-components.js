/**
 * @file Storybook mirrored component CSS side-effect loader.
 *
 * Drupal projects load component CSS from the mirrored root components tree,
 * but shared/global Storybook CSS still lives under dist. Exclude
 * dist/components so the mirrored component CSS is not loaded twice.
 */

// Load mirrored component output first so Drupal adapter stories match theme roots.
import.meta.glob('../../../../components/**/*.css', { eager: true });

// Keep shared dist CSS while avoiding duplicate generated component CSS.
import.meta.glob(
  ['../../../../dist/**/*.css', '!../../../../dist/components/**/*.css'],
  { eager: true },
);
