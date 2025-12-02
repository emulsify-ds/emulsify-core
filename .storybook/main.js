// .storybook/main.js

/**
 * Storybook main configuration file.
 * This configures stories, static directories, addons, core builder,
 * framework, documentation settings, manager head styles, and overrides.
 * @module .storybook/main
 */

import fs from 'fs';
import path, { resolve } from 'path';
import { fileURLToPath } from 'url';
import configOverrides from '../../../../config/emulsify-core/storybook/main.js';
import viteConfig from '../config/vite/vite.config.js';
import { resolveEnvironment } from '../config/vite/environment.js';

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
    '../../../../@(src|components)/**/*.stories.@(js|jsx|ts|tsx)',
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
    '@storybook/addon-a11y',
    '@storybook/addon-links',
    '@storybook/addon-themes',
  ],

  /**
   * Core builder configuration for Storybook.
   * @type {{builder: string, disableTelemetry: boolean}}
   */
  core: {
    builder: '@storybook/builder-vite',
    disableTelemetry: true,
  },

  /**
   * Framework specification for Storybook (HTML + Vite).
   * @type {{name: string, options: object}}
   */
  framework: {
    name: '@storybook/react-vite',
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
   * Custom styles injected into the Storybook manager (sidebar) head,
   * plus any external manager-head.html snippet.
   * @param {string} head - Existing head HTML.
   * @returns {string} Modified head HTML.
   */
  managerHead: (head) => {
    // inline theme styles
    const inlineStyles = `
      <style>
      :root {
        --colors-emulsify-blue-100: #e6f5fc;
        --colors-emulsify-blue-200: #CCECFA;
        --colors-emulsify-blue-300: #99D9F4;
        --colors-emulsify-blue-400: #66c5ef;
        --colors-emulsify-blue-500: #33b2e9;
        --colors-emulsify-blue-600: #009fe4;
        --colors-emulsify-blue-700: #007FB6;
        --colors-emulsify-blue-800: #005f89;
        --colors-emulsify-blue-900: #00405b;
        --colors-emulsify-blue-1000: #00202e;
        --colors-purple: #8B1E7E;
      }
      .sidebar-container {
        background: url('https://raw.githubusercontent.com/fourkitchens/emulsify-core/main/assets/images/corner-bkg.png?token=GHSAT0AAAAAACIEXLVDMX56QK3ZIZWHWHTEZNYFYIA') no-repeat top left;
      }
      .sidebar-container .sidebar-subheading {
        color: var(--colors-emulsify-blue-200);
        font-size: 13px;
        letter-spacing: 0.15em;
      }
      .sidebar-container .sidebar-subheading button:focus {
        color: var(--colors-emulsify-blue-300);
      }
      /** Triangle icon **/
      .sidebar-container .sidebar-subheading button span {
        color: var(--colors-emulsify-blue-300);
      }
      .sidebar-container .search-field input {
        border-color: var(--colors-emulsify-blue-700);
      }
      .sidebar-container .search-field input:active {
        border-color: var(--colors-emulsify-blue-700);
      }
      .sidebar-container .search-result-recentlyOpened,
      .sidebar-container .search-result-back,
      .sidebar-container .search-result-clearHistory {
        color: var(--colors-emulsify-blue-300) !important;
        letter-spacing: 0.15em;
      }
      .sidebar-container .search-result-back span,
      .sidebar-container .search-result-back svg,
      .sidebar-container .search-result-clearHistory span,
      .sidebar-container .search-result-clearHistory svg {
        letter-spacing: normal;
        color: white;
      }
      .sidebar-container .sidebar-item svg {
        margin-top: 1px;
      }
      .sidebar-container .sidebar-item span {
        margin-top: 4px;
      }
      .sidebar-container .sidebar-subheading-action svg {
        color: var(--colors-emulsify-blue-400);
      }
      .sidebar-container .sidebar-subheading-action:hover svg {
        color: var(--colors-emulsify-blue-300);
      }
      .sidebar-header button[title="Shortcuts"] {
        box-shadow: none;
        border: 1px solid var(--colors-emulsify-blue-700);
      }
      .sidebar-header button[title="Shortcuts"]:active {
        border: 1px solid var(--colors-emulsify-blue-500);
      }
      .sidebar-header button[title="Shortcuts"]:focus {
        background: transparent;
      }
      #shortcuts {
        border-bottom-color: var(--colors-emulsify-blue-900) !important;
      }
      [role="main"]:not(:nth-child(3)) {
        top: 1rem !important;
        height: calc(100vh - 2rem) !important;
      }
      [role="main"] .os-host .os-content button:hover {
        background: var(--colors-emulsify-blue-100);
      }
      [role="main"] .os-host .os-content button:hover svg {
        color: var(--colors-emulsify-blue-900);
      }
      #panel-tab-content,
      #panel-tab-content>* {
        color: var(--colors-emulsify-blue-100) !important;
      }
      #panel-tab-content a,
      #panel-tab-content a span,
      #panel-tab-content a span svg {
        color: var(--colors-emulsify-blue-800);
      }
      #panel-tab-content>div>div>div>div>div>div {
        background: transparent;
      }
      #panel-tab-content>div>div>div>div>div>div>div {
        color: var(--colors-emulsify-blue-1000) !important;
      }
    </style>
    `;

    // load external manager-head.html if present
    const externalManagerHeadPath = resolve(
      _dirname,
      '../../../../config/emulsify-core/storybook/manager-head.html'
    );
    let externalManagerHtml = '';
    if (fs.existsSync(externalManagerHeadPath)) {
      externalManagerHtml = fs.readFileSync(externalManagerHeadPath, 'utf8');
    }

    return `${head}
      ${inlineStyles}
      ${externalManagerHtml}`;
  },

  /**
   * Function to load and append an external preview-head.html into the preview iframe.
   * @param {string} head - Existing preview head HTML.
   * @returns {string} Combined head HTML including external snippet if present.
   */
  previewHead: (head) => {
    const externalHeadPath = resolve(
      _dirname,
      '../../../../config/emulsify-core/storybook/preview-head.html'
    );

    let externalHtml = '';
    if (fs.existsSync(externalHeadPath)) {
      externalHtml = fs.readFileSync(externalHeadPath, 'utf8');
    }

    return `${head}
      ${externalHtml}`;
  },

  // Storybook specific Vite configuration.
  async viteFinal(config) {
    const { mergeConfig } = await import('vite');
    const env = resolveEnvironment();
    const baseViteConfig =
      typeof viteConfig === 'function'
        ? await viteConfig({ command: 'serve', mode: config?.mode || 'development' })
        : viteConfig;
    const existingDefine = (config && config.define) || {};
    const viteDefine = (baseViteConfig && baseViteConfig.define) || {};
    const allowList = new Set([
      ...(config?.server?.fs?.allow || []),
      env.projectDir,
      path.resolve(env.projectDir, 'src'),
      path.resolve(env.projectDir, 'components'),
      path.resolve(env.projectDir, 'dist'),
    ]);
    const assetsInclude = Array.from(
      new Set([...(config.assetsInclude || []), ...(baseViteConfig.assetsInclude || []), '**/*.twig']),
    );
    const toRootRel = (abs) => {
      const rel = path.relative(env.projectDir, abs);
      const normalized = rel.split(path.sep).join('/');
      return `/${normalized}`.replace(/\/{2,}/g, '/');
    };
    const candidateRoots =
      env.structureOverrides && Array.isArray(env.structureRoots) && env.structureRoots.length
        ? env.structureRoots
        : env.srcDir
          ? [path.join(env.srcDir, 'components')]
          : [];
    const rootRels = candidateRoots.map(toRootRel);
    const globBases = rootRels.length ? rootRels : ['/src/components', '/components'];
    const twigGlobImports = `mergeGlobMaps([\n${globBases
      .map((base) => `  import.meta.glob('${base}/**/*.twig', { eager: true })`)
      .join(',\n')}\n])`;
    
    return mergeConfig(config, {
      ...baseViteConfig,
      define: {
        ...viteDefine,
        ...existingDefine,
        __EMULSIFY_ENV__: JSON.stringify(env),
      },
      server: {
        ...(baseViteConfig?.server || {}),
        fs: {
          allow: Array.from(allowList),
        },
      },
      assetsInclude,
      plugins: [
        ...(baseViteConfig?.plugins || []),
        {
          name: 'emulsify-inject-twig-globs',
          enforce: 'pre',
          transform(code, id) {
            const cleanId = id.split('?')[0];
            if (!cleanId.endsWith('/.storybook/polyfills/twig-resolver.js')) return null;
            const replaced = code.replace(
              /__EMULSIFY_TWIG_GLOB_IMPORTS__/g,
              twigGlobImports,
            );
            return replaced === code ? null : replaced;
          },
        },
      ],
      esbuild: {
        'jsx': 'automatic',
        loader: 'jsx',
        include: /.*\.jsx?$/,
        exclude: [],
      },
      optimizeDeps: {
        include: [
          'path',
          'twig',
          'twig-drupal-filters',
          'bem-twig-extension',
          'add-attributes-twig-extension',
        ],
        esbuildOptions: {
          loader: {
            '.js': 'jsx',
          },
        },
      },
    })
  },

  // Merge in user overrides without modifying original logic
  ...safeConfigOverrides,
};

export default config;
