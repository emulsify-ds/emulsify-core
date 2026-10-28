# Dependency review for 3.5.1

Registry queried on 2026-10-28. “Latest stable” is the numerically highest published semver version without a prerelease suffix, rather than an assumption about the `latest` tag. The complete registry snapshot records engines, peer requirements, release timestamps and the maximum stable version in each original major in [registry-inventory.json](maintenance-3.5.1/registry-inventory.json).

The published 3.5.0 manifest has 67 production dependencies and 11 development dependencies. It declares no peerDependencies or optionalDependencies. Consumer-required tooling remains in dependencies. Selected versions are declared minimum ranges; package-lock.json records the actual npm-generated resolution.

| Dependency | 3.5.0 range | 3.5.1 range | Latest stable | Decision |
| --- | --- | --- | --- | --- |
| `@babel/core` | `^7.28.5` | `^7.29.7` | `8.0.9` | Babel 8 requires Node >=24.11 within the 24.x line; retain latest 7.x for Node >=24.0. [Babel migration](https://babeljs.io/docs/v8-migration). |
| `@babel/preset-env` | `^7.28.5` | `^7.29.7` | `8.0.7` | Babel 8 requires Node >=24.11 and @babel/core ^8; keep the compatible Babel 7 family. [Babel migration](https://babeljs.io/docs/v8-migration). |
| `@emulsify/cli` | `^1.11.4` | `^1.12.2` | `2.4.1` | CLI 2 changes init/component workflows and validates a stricter project schema; keep CLI 1 commands and existing project configuration. [CLI 2 release](https://github.com/emulsify-ds/emulsify-cli/releases/tag/v2.0.0), [published schema](https://unpkg.com/@emulsify/cli@2.4.1/dist/schemas/emulsifyProjectConfig.json). |
| `@eslint/js` | `^10.0.1` | `^10.0.1` | `10.0.1` | Latest stable. |
| `@storybook/addon-a11y` | `^9.1.20` | `^9.1.21` | `10.6.5` | 10 requires native ESM main configurations and presets. Existing 3.x consumer overrides may supply CommonJS addon presets; Core cannot migrate those project files in a patch. Keep the matching latest 9.x family. [Storybook 10 migration](https://storybook.js.org/docs/releases/migration-guide). |
| `@storybook/addon-links` | `^9.1.20` | `^9.1.21` | `10.6.5` | 10 requires native ESM main configurations and presets. Existing 3.x consumer overrides may supply CommonJS addon presets; Core cannot migrate those project files in a patch. Keep the matching latest 9.x family. [Storybook 10 migration](https://storybook.js.org/docs/releases/migration-guide). |
| `@storybook/addon-styling-webpack` | `^2.0.0` | `^2.0.0` | `3.0.2` | Latest 3.0.2 requires Storybook ^10; 2.0.0 requires ^9. [Official manifest](https://registry.npmjs.org/@storybook%2faddon-styling-webpack/3.0.2). |
| `@storybook/addon-themes` | `^9.1.20` | `^9.1.21` | `10.6.5` | 10 requires native ESM main configurations and presets. Existing 3.x consumer overrides may supply CommonJS addon presets; Core cannot migrate those project files in a patch. Keep the matching latest 9.x family. [Storybook 10 migration](https://storybook.js.org/docs/releases/migration-guide). |
| `@storybook/builder-webpack5` | `^9.1.20` | `^9.1.21` | `10.6.5` | 10 requires native ESM main configurations and presets. Existing 3.x consumer overrides may supply CommonJS addon presets; Core cannot migrate those project files in a patch. Keep the matching latest 9.x family. [Storybook 10 migration](https://storybook.js.org/docs/releases/migration-guide). |
| `@storybook/server-webpack5` | `^9.1.20` | `^9.1.21` | `10.6.5` | 10 requires native ESM main configurations and presets. Existing 3.x consumer overrides may supply CommonJS addon presets; Core cannot migrate those project files in a patch. Keep the matching latest 9.x family. [Storybook 10 migration](https://storybook.js.org/docs/releases/migration-guide). |
| `add-attributes-twig-extension` | `^0.1.0` | `^0.1.0` | `0.1.0` | Latest stable. |
| `autoprefixer` | `^10.4.21` | `^10.6.2` | `10.6.2` | Latest stable. |
| `babel-loader` | `^10.0.0` | `^10.1.1` | `10.1.1` | Latest stable. |
| `babel-preset-minify` | `^0.5.2` | `^0.5.2` | `0.5.2` | Latest stable. |
| `bem-twig-extension` | `^0.1.1` | `^0.1.1` | `0.1.1` | Latest stable. |
| `breakpoint-sass` | `^3.0.0` | `^3.0.0` | `3.0.0` | Latest stable. |
| `clean-webpack-plugin` | `^4.0.0` | Removed | `4.0.0` | Removed: obsolete cleaning integration replaced with supported Webpack 5 cleaning APIs; avoids its del/rimraf/glob chain. [Webpack output.clean](https://webpack.js.org/configuration/output/#outputclean). |
| `concurrently` | `^9.2.1` | `^10.0.6` | `10.0.6` | Latest stable. |
| `copy-webpack-plugin` | `^14.0.0` | `^14.0.0` | `14.0.0` | Latest stable. |
| `css-loader` | `^7.1.1` | `^7.1.5` | `7.1.5` | Latest stable. |
| `eslint` | `^10.1.0` | `^10.13.0` | `10.13.0` | Latest stable. |
| `eslint-config-prettier` | `^10.1.8` | `^10.1.8` | `10.1.8` | Latest stable. |
| `eslint-plugin-jest` | `^29.15.1` | `^29.17.0` | `29.17.0` | Latest stable. |
| `eslint-plugin-prettier` | `^5.5.4` | `^5.5.7` | `5.5.7` | Latest stable. |
| `eslint-plugin-security` | `^4.0.0` | `^4.2.0` | `4.2.0` | Latest stable. |
| `file-loader` | `^6.2.0` | Removed | `6.2.0` | Removed: Core already uses Webpack 5 asset modules; no config, script or documentation references file-loader. [Webpack asset modules](https://webpack.js.org/guides/asset-modules/). |
| `fs-extra` | `^11.3.2` | `^11.4.1` | `11.4.1` | Latest stable. |
| `glob` | `^13.0.6` | `^14.0.3` | `14.0.3` | Latest stable. |
| `graceful-fs` | `^4.2.11` | `^4.2.11` | `4.2.11` | Latest stable. |
| `html-webpack-plugin` | `^5.6.4` | `^5.6.8` | `5.6.8` | Latest stable. |
| `image-minimizer-webpack-plugin` | `^5.0.0` | `^5.0.0` | `5.0.0` | Latest stable. |
| `imagemin` | `^9.0.1` | Removed | `9.0.1` | Removed with the obsolete native-binary image integration; see the image compatibility notes below. |
| `imagemin-jpegtran` | `^8.0.0` | Removed | `8.0.0` | Removed with the obsolete native-binary image integration; see the image compatibility notes below. |
| `imagemin-optipng` | `^8.0.0` | Removed | `8.0.0` | Removed with the obsolete native-binary image integration; see the image compatibility notes below. |
| `jest` | `^30.2.0` | `^30.5.2` | `30.5.2` | Latest stable. |
| `jest-environment-jsdom` | `^30.2.0` | `^30.5.2` | `30.5.2` | Latest stable. |
| `js-yaml` | `^4.1.0` | `^4.3.2` | `5.5.0` | 5 changes YAML scalar/tag resolution, removes Type/Schema.extend/DEFAULT_SCHEMA and changes empty-document behavior; keep latest 4.x so existing YAML data and custom schemas retain their semantics. [js-yaml migration](https://github.com/nodeca/js-yaml/blob/master/docs/migrate_v4_to_v5.md). |
| `js-yaml-loader` | `^1.2.2` | `^1.2.2` | `1.2.2` | Latest stable. |
| `mini-css-extract-plugin` | `^2.9.4` | `^2.10.2` | `2.10.2` | Latest stable. |
| `node-sass-glob-importer` | `^5.3.3` | Removed | `5.3.3` | Removed: legacy integration pulls obsolete glob; Core preserves glob import behavior using its supported glob dependency and Sass importer API. [Sass importer API](https://sass-lang.com/documentation/js-api/interfaces/legacyfileoptions/#importer). |
| `normalize.css` | `^8.0.1` | `^8.0.1` | `8.0.1` | Latest stable. |
| `open-cli` | `^9.0.0` | `^9.0.0` | `9.0.0` | Latest stable. |
| `pa11y` | `^9.0.1` | `^10.0.0` | `10.0.0` | Latest stable. |
| `postcss` | `^8.5.6` | `^8.5.32` | `8.5.32` | Latest stable. |
| `postcss-loader` | `^8.2.0` | `^8.2.1` | `8.2.1` | Latest stable. |
| `postcss-scss` | `^4.0.9` | `^4.0.9` | `4.0.9` | Latest stable. |
| `ramda` | `^0.32.0` | `^0.32.0` | `0.32.0` | Latest stable. |
| `regenerator-runtime` | `^0.14.1` | `^0.14.1` | `0.14.1` | Latest stable. |
| `sass` | `^1.93.2` | `^1.106.1` | `1.106.1` | Latest stable. |
| `sass-loader` | `^16.0.6` | `^16.0.8` | `17.1.0` | 17 removes the legacy Sass JS API used by Core and consumer custom importers; retain latest 16.x to preserve that configuration contract. [sass-loader 17 release](https://github.com/webpack/sass-loader/releases/tag/v17.0.0). |
| `storybook` | `^9.1.20` | `^9.1.21` | `10.6.5` | 10 requires native ESM main configurations and presets. Existing 3.x consumer overrides may supply CommonJS addon presets; Core cannot migrate those project files in a patch. Keep the matching latest 9.x family. [Storybook 10 migration](https://storybook.js.org/docs/releases/migration-guide). |
| `style-dictionary` | `^5.1.1` | `^5.7.1` | `5.7.1` | Latest stable. |
| `stylelint` | `^17.7.0` | `^17.16.0` | `17.16.0` | Latest stable. |
| `stylelint-config-standard-scss` | `^17.0.0` | `^17.0.0` | `17.0.0` | Latest stable. |
| `stylelint-prettier` | `^5.0.3` | `^5.0.3` | `5.0.3` | Latest stable. |
| `stylelint-webpack-plugin` | `^5.0.1` | `^5.1.0` | `5.1.0` | Latest stable. |
| `svg-spritemap-webpack-plugin` | `^5.0.3` | `^5.1.5` | `5.1.5` | Latest stable. |
| `terser-webpack-plugin` | `^5.3.9` | `^5.6.1` | `5.6.1` | Latest stable. |
| `token-transformer` | `^0.0.33` | `^0.0.33` | `0.0.33` | Latest stable, deprecated upstream. Retained because documented consumer tokens:transform calls its CLI; see limitations below. |
| `twig-drupal-filters` | `^3.2.0` | `^3.2.0` | `3.2.0` | Latest stable. |
| `twig-testing-library` | `^1.2.0` | `^1.2.0` | `1.2.0` | Latest stable. |
| `twigjs-loader` | `^1.0.3` | `^1.0.3` | `1.0.3` | Latest stable. |
| `webpack` | `^5.102.1` | `^5.112.2` | `5.112.2` | Latest stable. |
| `webpack-cli` | `^7.0.2` | `^7.2.3` | `7.2.3` | Latest stable. |
| `webpack-merge` | `^6.0.1` | `^6.0.1` | `6.0.1` | Latest stable. |
| `webpack-remove-empty-scripts` | `^1.1.1` | `^1.1.1` | `1.1.1` | Latest stable. |
| `yaml` | `^2.8.1` | `^2.9.1` | `2.9.1` | Latest stable. |
| `@commitlint/cli` | `^20.1.0` | `^21.2.4` | `21.2.4` | Latest stable. |
| `@commitlint/config-conventional` | `^20.0.0` | `^21.2.4` | `21.2.4` | Latest stable. |
| `@semantic-release/changelog` | `^6.0.2` | Removed | `7.0.0` | Removed: not used by release.config.cjs; avoids retaining an unneeded plugin requiring Node >=24.15. |
| `@semantic-release/commit-analyzer` | `^13.0.1` | `^13.0.1` | `13.0.1` | Latest stable. |
| `@semantic-release/git` | `^10.0.1` | Removed | `11.0.1` | Removed: not used by release.config.cjs; avoids retaining an unneeded plugin requiring Node >=24.15. |
| `@semantic-release/github` | `^12.0.6` | `^12.0.10` | `12.0.10` | Latest stable. |
| `@semantic-release/release-notes-generator` | `^14.1.0` | `^14.1.1` | `14.1.1` | Latest stable. |
| `all-contributors-cli` | `^6.26.1` | `^7.0.0` | `7.0.0` | Latest stable. |
| `husky` | `^9.1.7` | `^9.1.7` | `9.1.7` | Latest stable. |
| `lint-staged` | `^16.2.6` | `^17.6.0` | `17.6.0` | Latest stable. |
| `semantic-release` | `^25.0.3` | `^25.0.9` | `25.0.9` | Latest stable. |
| `@napi-rs/image` | — | `^1.16.0` | `1.16.0` | Latest stable; replaces the obsolete native-bin image integration through supported lossless image APIs. |
| `axe-core` | — | `^4.14.0` | `4.14.0` | Latest stable; makes an existing shipped runtime import explicit instead of depending on incidental hoisting. |
| `babel-jest` | — | `^30.5.2` | `30.5.2` | Latest stable; makes an existing shipped runtime import explicit instead of depending on incidental hoisting. |
| `process` | — | `^0.11.10` | `0.11.10` | Latest stable; makes an existing shipped runtime import explicit instead of depending on incidental hoisting. |
| `style-loader` | — | `^4.0.0` | `4.0.0` | Latest stable; makes an existing shipped runtime import explicit instead of depending on incidental hoisting. |
| `twig` | — | `^1.17.1` | `3.0.0` | Latest 3.0.0 does not satisfy current Twig loader/extensions peers (twig 1.x/^1.13.3). Retain latest compatible 1.17.1 and the existing Twig APIs. [Loader peer manifest](https://registry.npmjs.org/twigjs-loader/1.0.3), [extension peer manifest](https://registry.npmjs.org/add-attributes-twig-extension/0.1.0). |

## Compatibility review

- Babel remains on the latest 7.x family because Babel 8 would raise the minimum supported Node 24 version from 24.0 to 24.11. The package engine stays `>=24`.
- Storybook and all first-party addons/builders stay on matching 9.1.21 versions; addon-styling-webpack 2.0.0 declares Storybook ^9. The latest 10 family requires ESM main configurations and presets. Keeping 9 avoids requiring consumers to rewrite custom addon presets.
- Jest and jest-environment-jsdom both require ^30.5.2. eslint 10.13.0, @eslint/js 10.0.1 and eslint-plugin-jest 29.17.0 have mutually compatible peers; Stylelint 17.16.0, standard-scss 17.0.0 and webpack-plugin 5.1.0 likewise have compatible peer ranges.
- [concurrently 10](https://github.com/open-cli-tools/concurrently/releases/tag/v10.0.0) requires Node >=22 and removes the old --name-separator CLI flag and killOthers API option. The documented Core consumer commands use neither; normal concurrently commands continue to work on Node 24.
- [glob 14](https://github.com/isaacs/node-glob/releases/tag/v14.0.0) supports Node 18, 20 or >=22. Core uses the supported synchronous glob API; consumer build checks cover namespaced and globbed source discovery.
- [js-yaml 5 migration](https://github.com/nodeca/js-yaml/blob/master/docs/migrate_v4_to_v5.md) changes scalar and tag resolution, empty-input handling and custom schema APIs. Core retains latest 4.3.2 to keep the existing init/config YAML semantics. A partial compatibility schema would still change !!set or scalar behavior and is excluded from this patch.
- [Pa11y 10 migration](https://github.com/pa11y/pa11y/blob/main/MIGRATION.md) supports Node 24 and preserves the API used by Core. Its Puppeteer 25 dependency requires platform unzip tools; normal macOS/Linux installs provide these. Axe rule fixes can update accessibility findings, as they do in supported minor dependency refreshes.
- [Commitlint 21](https://github.com/conventional-changelog/commitlint/releases/tag/v21.0.0), [lint-staged 17](https://github.com/lint-staged/lint-staged/releases/tag/v17.0.0) and [all-contributors 7](https://github.com/all-contributors/cli/releases/tag/v7.0.0) support Node 24. The first changes CLI output formatting; lint-staged’s main change is its engine floor, and all-contributors migrates its implementation to ESM. Their existing Core CLI entry points remain supported.
- semantic-release 25.0.9 and its GitHub plugin 12.0.10 retain the same Node engine requirement as the original 25.0.3/12.0.6: ^22.14 or >=24.10. This is an existing maintainer-only release-tool floor; production consumers retain Node >=24.0. Release CI uses current Node 24. They are never moved into production dependencies.

## Known upstream limitations

- token-transformer 0.0.33 is deprecated and has no replacement release. The documented starter command `tokens:transform` calls this CLI, so silently removing it would break consumers. Migrating token formats or command names belongs in a future major release. [Published deprecation](https://registry.npmjs.org/token-transformer/0.0.33), [consumer scripts](https://github.com/emulsify-ds/emulsify-drupal/blob/7a26035005bae1a7a45ac56c95d44f15fc06f28c/whisk/package.json).
- whatwg-encoding 3.1.1 is deprecated. Its owner is Jest’s current jsdom integration; current jest-environment-jsdom uses a jsdom range that does not admit the new upstream replacement. Changing it would require an override or unsupported transitive pin. [Jest manifest](https://registry.npmjs.org/jest-environment-jsdom/30.5.2), [jsdom manifest](https://registry.npmjs.org/jsdom/26.1.0).

- glob 10.5.0 remains under Jest coverage: @jest/transform → babel-plugin-istanbul 8.0.0 → test-exclude ^7.0.1 → glob ^10.4.1. Latest test-exclude 8 uses supported glob, but the current upstream coverage plugin does not permit it. [Plugin manifest](https://registry.npmjs.org/babel-plugin-istanbul/8.0.0), [test-exclude 7](https://registry.npmjs.org/test-exclude/7.0.2), [test-exclude 8](https://registry.npmjs.org/test-exclude/8.0.0).

## Image integration

The old imagemin/jpegtran/optipng integration used native-bin lifecycle downloads and source builds; optipng fails during the 3.5.0 baseline install on macOS ARM64. Core now uses @napi-rs/image through ImageMinimizerPlugin’s supported custom minimizer API. losslessCompressPng preserves pixels and metadata (strip: false); compressJpeg uses lossless coefficient copying, optimized scans and progressive encoding. These preserve the existing lossless PNG/JPEG behavior without the obsolete binary installer dependencies. [Image API](https://image.napi.rs/docs/api), [Webpack custom minimizer API](https://webpack.js.org/plugins/image-minimizer-webpack-plugin/#minimizerimplementation).

Final audit findings and exact owning chains are recorded in [audit-deprecations-3.5.1.md](audit-deprecations-3.5.1.md).
