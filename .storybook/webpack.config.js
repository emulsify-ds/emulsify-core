import { dirname, resolve } from 'path';
import globImporter from 'node-sass-glob-importer';
import _StyleLintPlugin from 'stylelint-webpack-plugin';
import ESLintPlugin from 'eslint-webpack-plugin';
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

        if (
          requestPath &&
          requestPath.startsWith(`${this.prefix}:`)
        ) {
          const newRequestPath = requestPath.replace(
            `${this.prefix}:`,
            `${this.prefix}/`
          );
          const newRequest = {
            ...request,
            request: newRequestPath,
          };

          resolver.doResolve(
            target,
            newRequest,
            `Resolved ${this.prefix} URI: ${resolves.TwigResolve.alias[requestPath]}`,
            resolveContext,
            callback
          );
        } else {
          callback();
        }
      }
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
  // Alias
  Object.assign(config.resolve.alias, resolves.TwigResolve.alias);

  // Twig loader
  config.module.rules.push({
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
  });

  // SCSS Loader configuration
  config.module.rules.push({
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
  });

  // YAML loader
  config.module.rules.push({
    /**
     * @type {RegExp}
     */
    test: /\.ya?ml$/,
    loader: 'js-yaml-loader',
  });

  // StyleLint and ESLint plugins
  config.plugins.push(
    new _StyleLintPlugin({
      configFile: resolve(projectDir, '../', '.stylelintrc.json'),
      context: resolve(projectDir, '../', 'src'),
      files: '**/*.scss',
      failOnError: false,
      quiet: false,
    }),
    new ESLintPlugin({
      context: resolve(projectDir, '../', 'src'),
      extensions: ['js'],
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
