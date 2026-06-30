/**
 * Central Storybook configuration for Emulsify.
 *
 * This shared config defines the default Storybook behavior for consumers of
 * the package, then lets a project layer local overrides on top at the end.
 * The main custom behavior here is:
 * - injecting manager/preview head markup
 * - adapting the shared Vite config for Storybook
 * - wiring Twig template discovery into the Storybook build
 *
 * @module .storybook/main
 */

import fs from 'fs';
import path, { resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { resolveEnvironment } from '../config/vite/environment.js';
import {
  applyStorybookConfigOverrides,
  normalizeStorybookConfigOverrideModule,
} from '../src/storybook/main-config.js';
import { buildAssetStaticDirs } from './main-static-assets.js';
import { createViteFinal } from './main-vite.js';

/**
 * Minimal subset of the resolved Emulsify environment used by this file.
 *
 * @typedef {object} StorybookEnvironment
 * @property {string} projectDir - Absolute path to the consuming project root.
 * @property {boolean} [structureOverrides] - Whether custom structure roots are enabled.
 * @property {string[]} [structureRoots] - Absolute component root paths when overrides are active.
 * @property {string[]} [componentRoots] - Absolute component roots in resolution order.
 * @property {Record<string, string>} [namespaceRoots] - Twig namespace roots.
 * @property {string} [srcDir] - Absolute path to the project's `src` directory when present.
 */

/**
 * Storybook config type used for editor hints in this plain JS file.
 * @typedef {import('@storybook/core-common').StorybookConfig} StorybookConfig
 */

/**
 * The full path to the current file (ESM compatible).
 * @type {string}
 */
const _filename = fileURLToPath(import.meta.url);

/**
 * The directory name of the current module file.
 * @type {string}
 */
const _dirname = path.dirname(_filename);

/**
 * Reads an optional HTML fragment relative to this config file.
 *
 * Missing files are treated as empty content so downstream projects can opt in
 * to extra markup without making Storybook fail on startup.
 *
 * @param {string} relativePath - Relative path from this file to the HTML fragment.
 * @returns {string} File contents when the fragment exists, otherwise an empty string.
 */
function readOptionalHtmlFragment(relativePath) {
  const fragmentPath = resolve(_dirname, relativePath);

  if (!fs.existsSync(fragmentPath)) {
    return '';
  }

  return fs.readFileSync(fragmentPath, 'utf8');
}

/**
 * Reads optional project-level Storybook overrides.
 *
 * Downstream projects can provide this file, but the shared config also needs
 * to load in package-level smoke tests where that project file is absent.
 *
 * @returns {Promise<{ config: object|Function, extendConfig?: Function, replaceAddons: boolean }>}
 * Consumer overrides.
 */
async function loadConfigOverrides() {
  const overridePath = resolve(
    _dirname,
    '../../../../config/emulsify-core/storybook/main.js',
  );

  if (!fs.existsSync(overridePath)) {
    return normalizeStorybookConfigOverrideModule();
  }

  const configOverrides = await import(pathToFileURL(overridePath).href);
  return normalizeStorybookConfigOverrideModule(configOverrides);
}

/**
 * Builds Storybook story globs from normalized project roots.
 *
 * Stories remain colocated with components, whether the project uses the
 * recommended `src/components` layout, legacy root `components`, or explicit
 * structure implementation directories.
 *
 * @param {StorybookEnvironment} env - Resolved project paths used by Storybook.
 * @returns {string[]} Storybook story globs.
 */
function buildStoryGlobs(env) {
  if (Array.isArray(env.projectStructure?.storyRoots)) {
    return env.projectStructure.storyRoots.map((root) =>
      path
        .resolve(root, '**/*.stories.@(js|jsx|ts|tsx)')
        .split(path.sep)
        .join('/'),
    );
  }

  const roots =
    env.structureOverrides &&
    Array.isArray(env.structureRoots) &&
    env.structureRoots.length
      ? env.structureRoots
      : [
          path.resolve(env.projectDir, 'src'),
          path.resolve(env.projectDir, 'components'),
        ];

  return Array.from(new Set(roots.filter(Boolean))).map((root) =>
    path
      .resolve(root, '**/*.stories.@(js|jsx|ts|tsx)')
      .split(path.sep)
      .join('/'),
  );
}

/**
 * Safely apply any user-provided overrides or fall back to an empty object.
 * @type {object}
 */
const safeConfigOverrides = await loadConfigOverrides();

/**
 * Environment details shared across this Storybook config load.
 * @type {StorybookEnvironment}
 */
const resolvedStorybookEnv = resolveEnvironment();

/**
 * Primary Storybook configuration object.
 * @type {StorybookConfig}
 */
const baseConfig = {
  /**
   * Discover stories from both supported component roots.
   *
   * This shared config supports projects that keep stories under `src` as well
   * as projects that expose a top-level `components` directory.
   *
   * @type {string[]}
   */
  stories: buildStoryGlobs(resolvedStorybookEnv),

  /**
   * Mount shared assets into Storybook's static file server.
   *
   * Anything referenced by URL inside stories should live in one of these
   * directories so it works in both `storybook dev` and static builds.
   *
   * @type {Array<string|{from: string, to: string}>}
   */
  staticDirs: buildAssetStaticDirs(resolvedStorybookEnv),

  /**
   * Enable the default addon set used by Emulsify.
   *
   * `a11y` adds accessibility tooling, `links` supports story-to-story
   * navigation, and `themes` exposes theme switching in the Storybook UI.
   *
   * @type {string[]}
   */
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-links',
    '@storybook/addon-themes',
  ],

  /**
   * Force the Vite builder and disable Storybook telemetry for shared usage.
   * @type {{builder: string, disableTelemetry: boolean}}
   */
  core: {
    builder: '@storybook/builder-vite',
    disableTelemetry: true,
  },

  /**
   * Tell Storybook to use the React + Vite framework package.
   * @type {{name: string, options: object}}
   */
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },

  /**
   * Disable automatic docs generation.
   *
   * Storybook will only render documentation pages that are authored
   * explicitly instead of generating them from component metadata.
   *
   * @type {{autodocs: boolean}}
   */
  docs: {
    autodocs: false,
  },

  /**
   * Appends Emulsify branding to the Storybook manager UI.
   *
   * This only affects Storybook's chrome, such as the sidebar, toolbar, and
   * addon panels. It does not affect the iframe where stories actually render.
   *
   * @param {string} head - Existing manager head markup provided by Storybook.
   * @returns {string} Manager head markup with Emulsify additions appended.
   */
  managerHead: (head) => {
    const managerStyles = readOptionalHtmlFragment('./manager-head.css');
    const inlineStyles = managerStyles
      ? `<style>
${managerStyles}
</style>`
      : '';
    const externalManagerHtml = readOptionalHtmlFragment(
      '../../../../config/emulsify-core/storybook/manager-head.html',
    );

    return `${head}
      ${inlineStyles}
      ${externalManagerHtml}`;
  },

  /**
   * Appends project-level head markup to the story preview iframe.
   *
   * This is the place for preview-only fonts, scripts, or meta tags that the
   * rendered component output depends on.
   *
   * @param {string} head - Existing preview head markup provided by Storybook.
   * @returns {string} Preview head markup with optional project HTML appended.
   */
  previewHead: (head) => {
    const externalHtml = readOptionalHtmlFragment(
      '../../../../config/emulsify-core/storybook/preview-head.html',
    );

    return `${head}
      ${externalHtml}`;
  },

  viteFinal: createViteFinal(resolvedStorybookEnv),
};

/**
 * Primary Storybook configuration after project overrides have been applied.
 * Project `addons` append to Emulsify defaults unless replacement is requested.
 *
 * @type {StorybookConfig}
 */
const config = await applyStorybookConfigOverrides(
  baseConfig,
  safeConfigOverrides,
  { env: resolvedStorybookEnv },
);

export default config;
