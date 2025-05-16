// .storybook/main.js

/**
 * Storybook main configuration file.
 * This configures stories, static directories, addons, core builder,
 * framework, documentation settings, manager head styles, and overrides.
 * @module .storybook/main
 */

import { resolve } from 'path';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import configOverrides from '../../../../config/emulsify-core/storybook/main.js';

/**
 * The full path to the current file (ESM compatible).
 * @type {string}
 */
const __filename = fileURLToPath(import.meta.url);

/**
 * The directory name of the current module file.
 * @type {string}
 */
const __dirname  = path.dirname(__filename);

/**
 * Safely apply any user-provided overrides or fall back to an empty object.
 * @type {object}
 */
const safeConfigOverrides = configOverrides || {};

/**
 * Primary Storybook configuration object.
 * @type {import('@storybook/core-common').StorybookConfig}
 */
const config = {
  /**
   * Patterns for locating story files under src or components directories.
   * @type {string[]}
   */
  stories: [
    '../../../../(src|components)/**/*.stories.@(js|jsx|ts|tsx)',
  ],

  /**
   * Directories to serve as static assets in the Storybook build.
   * @type {string[]}
   */
  staticDirs: [
    '../../../../assets/images',
    '../../../../assets/icons',
    '../../../../dist',
  ],

  /**
   * List of Storybook addons to enable various features.
   * @type {string[]}
   */
  addons: [
    '../../../@storybook/addon-a11y',
    '../../../@storybook/addon-links',
    '../../../@storybook/addon-essentials',
    '../../../@storybook/addon-themes',
    '../../../@storybook/addon-styling-webpack',
  ],

  /**
   * Core builder configuration for Storybook.
   * @type {{builder: string, disableTelemetry: boolean}}
   */
  core: {
    builder: 'webpack5',
    disableTelemetry: true,
  },

  /**
   * Framework specification for Storybook (HTML + Webpack5).
   * @type {{name: string, options: object}}
   */
  framework: {
    name: '@storybook/html-webpack5',
    options: {},
  },

  /**
   * Documentation settings for Storybook autodocs.
   * @type {{autodocs: boolean}}
   */
  docs: {
    autodocs: false,
  },

  /**
   * Custom styles injected into the Storybook manager (sidebar) head.
   * @param {string} head - Existing head HTML.
   * @returns {string} Modified head HTML with custom styles.
   */
  managerHead: (head) =>
    `${head}
    <style>
      :root {
        --colors-emulsify-blue-100: #e6f5fc;
        /* ... additional CSS variables ... */
        --colors-purple: #8B1E7E;
      }
      /* ... additional sidebar styles ... */
    </style>`,

  /**
   * Function to load and append an external preview-head.html into the preview iframe.
   * @param {string} head - Existing preview head HTML.
   * @returns {string} Combined head HTML including external snippet if present.
   */
  previewHead: (head) => {
    // Resolve the external preview-head.html path
    const externalHeadPath = resolve(
      __dirname,
      '../../../../config/emulsify-core/storybook/preview-head.html'
    );

    let externalHtml = '';
    if (fs.existsSync(externalHeadPath)) {
      externalHtml = fs.readFileSync(externalHeadPath, 'utf8');
    }

    return `${head}
${externalHtml}`;
  },

  // Merge in user overrides without modifying original logic
  ...safeConfigOverrides,
};

export default config;
