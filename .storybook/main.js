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
import viteConfig from '../config/vite/vite.config.js';
import { resolveEnvironment } from '../config/vite/environment.js';

/**
 * Minimal subset of the resolved Emulsify environment used by this file.
 *
 * @typedef {object} StorybookEnvironment
 * @property {string} projectDir - Absolute path to the consuming project root.
 * @property {boolean} [structureOverrides] - Whether custom structure roots are enabled.
 * @property {string[]} [structureRoots] - Absolute component root paths when overrides are active.
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
 * Keeps Storybook static directory config aligned to the consuming project.
 *
 * Storybook errors when a declared static directory is absent, so only expose
 * project asset directories that exist in the current workspace.
 *
 * @param {string[]} staticDirs - Absolute static directory paths.
 * @returns {string[]} Existing static directory paths.
 */
function existingStaticDirs(staticDirs) {
  return staticDirs.filter((staticDir) => fs.existsSync(staticDir));
}

/**
 * Converts an absolute path inside the project into the root-relative format
 * Vite expects for `import.meta.glob()` patterns.
 *
 * The path separator normalization matters because Storybook may run on
 * Windows as well as POSIX systems.
 *
 * @param {string} projectDir - Absolute path to the consuming project root.
 * @param {string} absolutePath - Absolute path that should become root-relative.
 * @returns {string} Vite-compatible root-relative path.
 */
function toRootRelativePath(projectDir, absolutePath) {
  const rel = path.relative(projectDir, absolutePath);
  const normalized = rel.split(path.sep).join('/');

  return `/${normalized}`.replace(/\/{2,}/g, '/');
}

/**
 * Reads optional project-level Storybook overrides.
 *
 * Downstream projects can provide this file, but the shared config also needs
 * to load in package-level smoke tests where that project file is absent.
 *
 * @returns {Promise<object>} Consumer overrides, or an empty object.
 */
async function loadConfigOverrides() {
  const overridePath = resolve(
    _dirname,
    '../../../../config/emulsify-core/storybook/main.js',
  );

  if (!fs.existsSync(overridePath)) {
    return {};
  }

  const configOverrides = await import(pathToFileURL(overridePath).href);
  return configOverrides.default || {};
}

/**
 * Builds candidate roots whose Twig files should be importable in Storybook.
 *
 * Modern projects usually resolve `srcDir` to `src`, while component templates
 * live under `src/components`. Legacy projects may resolve directly to a
 * top-level `components` directory. Keep both shapes importable.
 *
 * @param {StorybookEnvironment} env - Resolved project paths used by Storybook.
 * @returns {string[]} Absolute candidate roots.
 */
function buildTwigCandidateRoots(env) {
  const rawRoots =
    env.structureOverrides &&
    Array.isArray(env.structureRoots) &&
    env.structureRoots.length
      ? env.structureRoots
      : env.srcDir
        ? [env.srcDir]
        : [];
  const roots = new Set();

  for (const root of rawRoots) {
    roots.add(root);
    if (path.basename(root) !== 'components') {
      roots.add(path.resolve(root, 'components'));
    }
  }

  if (!roots.size) {
    roots.add(path.resolve(env.projectDir, 'src'));
    roots.add(path.resolve(env.projectDir, 'src/components'));
    roots.add(path.resolve(env.projectDir, 'components'));
  }

  return Array.from(roots);
}

/**
 * Builds the `import.meta.glob()` expression injected into the Twig resolver.
 *
 * The component roots can move when a project enables structure overrides, so
 * the import list is generated at runtime instead of hard-coded.
 *
 * @param {StorybookEnvironment} env - Resolved project paths used by Storybook.
 * @returns {string} JavaScript source that eagerly imports Twig templates.
 */
function buildTwigGlobImports(env) {
  const rootRelativePaths = buildTwigCandidateRoots(env).map((root) =>
    toRootRelativePath(env.projectDir, root),
  );
  const globBases = rootRelativePaths.length
    ? rootRelativePaths
    : ['/src', '/src/components', '/components'];

  return `mergeGlobMaps([\n${globBases
    .map((base) => `  import.meta.glob('${base}/**/*.twig', { eager: true })`)
    .join(',\n')}\n])`;
}

/**
 * Safely apply any user-provided overrides or fall back to an empty object.
 * @type {object}
 */
const safeConfigOverrides = await loadConfigOverrides();

/**
 * Primary Storybook configuration object.
 * @type {StorybookConfig}
 */
const config = {
  /**
   * Discover stories from both supported component roots.
   *
   * This shared config supports projects that keep stories under `src` as well
   * as projects that expose a top-level `components` directory.
   *
   * @type {string[]}
   */
  stories: [
    path
      .resolve(process.cwd(), '@(src|components)/**/*.stories.@(js|jsx|ts|tsx)')
      .split(path.sep)
      .join('/'),
  ],

  /**
   * Mount shared assets into Storybook's static file server.
   *
   * Anything referenced by URL inside stories should live in one of these
   * directories so it works in both `storybook dev` and static builds.
   *
   * @type {string[]}
   */
  staticDirs: [
    ...existingStaticDirs([
      path.resolve(process.cwd(), 'assets/images'),
      path.resolve(process.cwd(), 'assets/icons'),
      path.resolve(process.cwd(), 'dist'),
    ]),
  ],

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
    // Keep the manager styling inline so consumers inherit the branded UI
    // without having to maintain a separate manager-only stylesheet.
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
      /* Triangle icon. */
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

  /**
   * Merges Storybook's generated Vite config with Emulsify's shared Vite config.
   *
   * Storybook supplies a baseline config, but Emulsify still needs to expose
   * the resolved environment, expand filesystem access, and inject the Twig
   * template globs used by the runtime resolver.
   *
   * @param {import('vite').UserConfig} config - Storybook's generated Vite config.
   * @returns {Promise<import('vite').UserConfig>} Final Vite config used by Storybook.
   */
  async viteFinal(config) {
    const { mergeConfig } = await import('vite');
    /** @type {StorybookEnvironment} */
    const env = resolveEnvironment();

    // Keep using the `serve` branch of the shared Vite config here. Storybook
    // has historically consumed that branch, while `mode` still reflects
    // whether Storybook is running in development or production.
    const mode = config?.mode || 'development';
    const baseViteConfig =
      typeof viteConfig === 'function'
        ? await viteConfig({ command: 'serve', mode })
        : viteConfig;
    const existingDefine = (config && config.define) || {};
    const viteDefine = (baseViteConfig && baseViteConfig.define) || {};

    // Allow Storybook's dev server to read component sources from the project
    // root and any structure override paths used by Emulsify consumers.
    const allowList = new Set([
      ...(config?.server?.fs?.allow || []),
      env.projectDir,
      path.resolve(env.projectDir, 'src'),
      path.resolve(env.projectDir, 'components'),
      path.resolve(env.projectDir, 'dist'),
    ]);

    // Twig files are loaded through custom resolvers/plugins, so they need to
    // be treated as importable assets by Storybook's Vite pipeline.
    const assetsInclude = Array.from(
      new Set([
        ...(config.assetsInclude || []),
        ...(baseViteConfig.assetsInclude || []),
        '**/*.twig',
      ]),
    );
    const twigGlobImports = buildTwigGlobImports(env);

    return mergeConfig(config, {
      ...baseViteConfig,
      define: {
        // Preserve shared and Storybook-provided constants, then publish the
        // resolved Emulsify environment to client-side code.
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
            if (!cleanId.endsWith('/.storybook/polyfills/twig-resolver.js')) {
              return null;
            }

            // Replace the placeholder token in the Twig resolver polyfill with
            // the project-specific import list computed above.
            const replaced = code.replace(
              /__EMULSIFY_TWIG_GLOB_IMPORTS__/g,
              twigGlobImports,
            );
            return replaced === code ? null : replaced;
          },
        },
      ],
      esbuild: {
        // Some downstream code is authored as `.js` files containing JSX, so
        // keep Storybook's esbuild settings aligned with the shared Vite config.
        jsx: 'automatic',
        loader: 'jsx',
        include: /.*\.jsx?$/,
        exclude: [],
      },
      optimizeDeps: {
        include: ['react', 'path', 'twig', 'twig-drupal-filters'],
        esbuildOptions: {
          loader: {
            // Pre-bundle `.js` dependencies with the JSX loader for packages
            // that ship JSX without a `.jsx` extension.
            '.js': 'jsx',
          },
        },
      },
    });
  },

  // Spread consumer overrides last so local projects can replace defaults above.
  ...safeConfigOverrides,
};

export default config;
