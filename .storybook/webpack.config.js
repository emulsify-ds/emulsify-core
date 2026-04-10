import { dirname, resolve } from 'path';
import globImporter from 'node-sass-glob-importer';
import _StyleLintPlugin from 'stylelint-webpack-plugin';
import resolves from '../config/webpack/resolves.js';
import emulsifyConfig from '../../../../project.emulsify.json' with { type: 'json' };

// Create __filename from import.meta.url without fileURLToPath
let _filename = decodeURIComponent(new URL(import.meta.url).pathname);

// On Windows, remove the leading slash (e.g. "/C:/path" -> "C:/path")
if (process.platform === 'win32' && _filename.startsWith('/')) {
  _filename = _filename.slice(1);
}

/**
 * Directory name of the current file.
 * @type {string}
 */
const _dirname = dirname(_filename);

/**
 * Absolute path to the project root directory.
 * @type {string}
 */
const projectDir = resolve(_dirname, '../../../../..');

/**
 * Webpack plugin to resolve custom namespace imports.
 * Transforms `<prefix>:<component>` into `<prefix>/<component>` paths.
 */
class ProjectNameResolverPlugin {
  /**
   * @param {object} options - Plugin options.
   * @param {string} options.projectName - Prefix for the project namespace.
   */
  constructor(options = {}) {
    this.prefix = options.projectName;
  }

  /**
   * Apply the webpack resolver hook.
   * @param {object} resolver - The webpack resolver instance.
   */
  apply(resolver) {
    const target = resolver.ensureHook('resolve');
    resolver.getHook('before-resolve').tapAsync(
      'ProjectNameResolverPlugin',
      /**
       * @param {object} request - The resolve request object.
       * @param {object} resolveContext - Context for resolving.
       * @param {Function} callback - Callback to continue resolution.
       */
      (request, resolveContext, callback) => {
        const requestPath = request.request;

        if (requestPath && requestPath.startsWith(`${this.prefix}:`)) {
          const newRequestPath = requestPath.replace(
            `${this.prefix}:`,
            `${this.prefix}/`,
          );
          const newRequest = {
            ...request,
            request: newRequestPath,
          };

          resolver.doResolve(
            target,
            newRequest,
            `Resolved ${this.prefix} URI`,
            resolveContext,
            callback,
          );
        } else {
          callback();
        }
      },
    );
  }
}

/**
 * Export a function to customize the Webpack config for Storybook.
 * @param {object} param0 - The Storybook configuration object.
 * @param {object} param0.config - The existing webpack config to modify.
 * @returns {object} The updated webpack config.
 */
export default async function ({ config }) {
  config.module = config.module || {};
  config.module.rules = config.module.rules || [];

  const hasLoader = (rule, loaderName) => {
    if (!rule) {
      return false;
    }

    if (typeof rule.loader === 'string' && rule.loader.includes(loaderName)) {
      return true;
    }

    const use = rule.use;
    if (typeof use === 'string') {
      return use.includes(loaderName);
    }
    if (Array.isArray(use)) {
      return use.some((entry) => {
        if (typeof entry === 'string') {
          return entry.includes(loaderName);
        }
        return (
          entry &&
          typeof entry.loader === 'string' &&
          entry.loader.includes(loaderName)
        );
      });
    }

    return false;
  };

  const hasRule = (testRegex, loaderName) =>
    config.module.rules.some(
      (rule) =>
        rule &&
        rule.test &&
        String(rule.test) === String(testRegex) &&
        hasLoader(rule, loaderName),
    );

  const pushRuleOnce = (rule, loaderName) => {
    if (!hasRule(rule.test, loaderName)) {
      config.module.rules.push(rule);
    }
  };

  // Alias
  Object.assign(config.resolve.alias, resolves.TwigResolve.alias);

  // Twig loader
  pushRuleOnce(
    {
      /**
       * @type {RegExp}
       */
      test: /\.twig$/,
      use: [
        {
          /**
           * Custom loader for svg/spritemap integration.
           * @type {string}
           */
          loader: resolve(_dirname, '../config/webpack/sdc-loader.js'),
          options: {
            /**
             * Name of the Emulsify project for resolving.
             * @type {string}
             */
            projectName: emulsifyConfig.project.name,
          },
        },
        {
          /**
           * Standard Twig JS loader.
           * @type {string}
           */
          loader: 'twigjs-loader',
        },
      ],
    },
    'twigjs-loader',
  );

  // SCSS Loader configuration
  pushRuleOnce(
    {
      test: /\.s[ac]ss$/i,
      use: [
        'style-loader',
        {
          loader: 'css-loader',
          options: {
            /**
             * Enable source maps for CSS.
             * @type {boolean}
             */
            sourceMap: true,
          },
        },
        {
          loader: 'sass-loader',
          options: {
            sourceMap: true,
            sassOptions: {
              importer: globImporter(),
            },
          },
        },
      ],
    },
    'sass-loader',
  );

  // YAML loader
  pushRuleOnce(
    {
      /**
       * @type {RegExp}
       */
      test: /\.ya?ml$/,
      loader: 'js-yaml-loader',
    },
    'js-yaml-loader',
  );

  // Keep style linting in the Storybook webpack build. ESLint runs via the
  // dedicated npm scripts instead, which avoids coupling Storybook to a
  // specific ESLint major version.
  config.plugins.push(
    new _StyleLintPlugin({
      configFile: resolve(projectDir, '../', '.stylelintrc.json'),
      context: resolve(projectDir, '../', 'src'),
      files: '**/*.scss',
      failOnError: false,
      quiet: false,
    }),
  );

  // Custom resolver plugin for namespaced imports
  config.resolve.plugins = [
    new ProjectNameResolverPlugin({
      projectName: emulsifyConfig.project.name,
    }),
  ];

  // Fallback for optional modules
  config.resolve.fallback = {
    /**
     * Prevent resolution of components directory if missing.
     */
    '../../../../components': false,
  };

  return config;
}
