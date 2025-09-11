/* eslint-disable */

/**
 * @file Vite plugins factory for Emulsify.
 * @description Exposes a function that takes the resolved environment and returns the plugins array.
 */

import { resolve } from 'path';
import yml from '@modyfi/vite-plugin-yaml';
import twig from 'vite-plugin-twig-drupal';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import svgSprite from 'vite-plugin-svg-sprite';

/**
 * Create the Vite plugins array based on environment.
 *
 * @param {{
 *   projectDir: string,
 *   isDrupal: boolean,
 *   srcDir: string,
 *   srcExists: boolean
 * }} env - Environment object from resolveEnvironment().
 * @returns {import('vite').PluginOption[]} Vite plugins array.
 */
export function makePlugins(env) {
  const { projectDir, isDrupal, srcExists } = env;

  return [
    /**
     * Parse/render Twig templates (useful for Drupal/Storybook previewing).
     * Adjust namespaces to your repository layout.
     */
    twig({
      framework: 'react',
      namespaces: {
        components: resolve(projectDir, './src/components'),
        layout: resolve(projectDir, './src/layout'),
        tokens: resolve(projectDir, './src/tokens'),
      },
    }),

    /** Enable importing .yml/.yaml files */
    yml(),

    /**
     * Copy Twig templates into build output (or Drupal components dir),
     * mirroring the Webpack Copy plugin behavior.
     */
    viteStaticCopy({
      targets: [
        {
          src: srcExists ? 'src/components/**/*.twig' : 'components/**/*.twig',
          dest: isDrupal && srcExists ? 'components' : 'dist/components',
        },
        // Add more targets if you previously copied images/videos/etc:
        // { src: 'src/components/**/*.{png,jpg,jpeg,svg,webp,mp4}', dest: 'dist/images' },
      ],
    }),

    /**
     * Optional SVG sprite generation (rough analogue to svg-spritemap-webpack-plugin).
     * If you prefer a single physical sprite file, consult the plugin docs and
     * set output options accordingly.
     */
    svgSprite({
      include: ['assets/icons/**/*.svg'],
    }),
  ];
}
