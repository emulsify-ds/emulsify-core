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

const _dirname = dirname(_filename);
const projectDir = resolve(_dirname, '../../../../..');

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
      .tapAsync(
        'ProjectNameResolverPlugin',
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

export default async function ({ config }) {
  // Alias
  Object.assign(config.resolve.alias, resolves.TwigResolve.alias);

  // Twig
  config.module.rules.push({
    test: /\.twig$/,
    use: [
      {
        loader: resolve(
          _dirname,
          '../config/webpack/sdc-loader.js'
        ),
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
}
