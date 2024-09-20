const path = require('path');
const globImporter = require('node-sass-glob-importer');

const _StyleLintPlugin = require('stylelint-webpack-plugin');
const ESLintPlugin = require('eslint-webpack-plugin');
const resolves = require('../config/webpack/resolves');

// Emulsify project configuration.
const emulsifyConfig = require('../../../../project.emulsify.json');

/**
 * Transforms namespace:component to @namespace/template/path
 */
class ProjectNameResolverPlugin {
  constructor(options = {}) {
    this.prefix = options.projectName;
  }

  apply(resolver) {
    const target = resolver.ensureHook('resolve');
    resolver
      .getHook('before-resolve')
      .tapAsync('ProjectNameResolverPlugin', (request, resolveContext, callback) => {
        const requestPath = request.request;

        if (requestPath && requestPath.startsWith(`${this.prefix}:`)) {
          const newRequestPath = requestPath.replace(`${this.prefix}:`, `${this.prefix}/`);
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
      });
  }
}

module.exports = async ({ config }) => {
  // Alias
  Object.assign(config.resolve.alias, resolves.TwigResolve.alias);

  // Twig
  config.module.rules.push({
    test: /\.twig$/,
    use: [
      {
        loader: path.resolve(__dirname, '../config/webpack/sdc-loader.js'),
        options: {
          projectName: emulsifyConfig.project.name,
        },
      },
      {
        loader: 'twigjs-loader',
      },
    ],
  });

  // SCSS
  config.module.rules.push({
    test: /\.s[ac]ss$/i,
    use: [
      'style-loader',
      {
        loader: 'css-loader',
        options: {
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

  // YAML
  config.module.rules.push({
    test: /\.ya?ml$/,
    loader: 'js-yaml-loader',
  });

  // Plugins
  config.plugins.push(
    new _StyleLintPlugin({
      configFile: path.resolve(__dirname, '../', '.stylelintrc.json'),
      context: path.resolve(__dirname, '../', 'src'),
      files: '**/*.scss',
      failOnError: false,
      quiet: false,
    }),
    new ESLintPlugin({
      context: path.resolve(__dirname, '../', 'src'),
      extensions: ['js'],
    }),
  );

  // Resolver Plugins
  config.resolve.plugins = [
    new ProjectNameResolverPlugin({
      projectName: emulsifyConfig.project.name,
    }),
  ];

  // Configure fallback for optional modules that may not be present
  config.resolve.fallback = {
    '../../../../components': false,
  };

  return config;
};
