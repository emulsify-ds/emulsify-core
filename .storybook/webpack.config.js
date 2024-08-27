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
    this.prefix = `${emulsifyConfig.project.name}:`; // Project name prefix.
  }
  apply(resolver) {
    const target = resolver.ensureHook('resolved');
    resolver
      .getHook('resolve')
      .tapAsync('ProjectNameResolverPlugin', (request, resolveContext, callback) => {
        if (request.request.startsWith(this.prefix)) {

          // Start - map request to @ aliases.
          const file = resolves.TwigResolve.alias[request.request];
          const srcStructure = file.split(`${emulsifyConfig.project.name}/src/`)[1];
          const parentDir = srcStructure.split(`/`)[0];
          const filePath = file.split(`/src/${parentDir}`)[1];
          const newRequest = {
            ...request,
            request: `@${parentDir}${filePath}`,
          };
          // End - map request to @ aliases.

          // Change request to full file path.
          // const newRequest = {
          //   ...request,
          //   request: resolves.TwigResolve.alias[request.request],
          // };

          // console.log(newRequest);

          return resolver.doResolve(
            target,
            newRequest,
            `Resolved ${this.prefix} URI: ${resolves.TwigResolve.alias[request.request]}`,
            resolveContext,
            callback
          );
        } else {
          // Proceed with default resolution if the custom prefix is not matched
          callback();
        }
      });
  }
}

module.exports = async ({ config }) => {
  // Alias
  Object.assign(config.resolve.alias, resolves.TwigResolve.alias);
  config.resolve.plugins = [new ProjectNameResolverPlugin];
  // console.log(config.resolve);
  // Twig
  config.module.rules.push({
    test: /\.twig$/,
    use: [
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

  // YAML
  config.module.rules.push({
    test: /\.ya?ml$/,
    loader: 'js-yaml-loader',
  });

  return config;
};
