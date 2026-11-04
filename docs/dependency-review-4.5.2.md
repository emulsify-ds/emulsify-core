# Dependency review for Core 4.5.2

Registry review dated November 4, 2026. The inventory was retrieved at
07:39 UTC and excludes prereleases. The tables compare the declared requirements
before this update with the selected requirements and the latest stable registry
releases as of that review.

This update raises 31 dependency requirements. Caret ranges establish the selected
versions as new minimums. The seven related Storybook packages retain exact
`10.6.5` requirements to keep the family aligned. Core continues to require
Node.js `>=24.13.0`.

## Dependencies

| Package                               | Previous requirement | Selected requirement | Latest stable                                                                      | Selection                               |
| ------------------------------------- | -------------------- | -------------------- | ---------------------------------------------------------------------------------- | --------------------------------------- |
| `@babel/core`                         | `^7.29.7`            | `^7.29.7`            | [8.1.0](https://www.npmjs.com/package/@babel/core/v/8.1.0)                         | Babel compiler compatibility            |
| `@babel/eslint-parser`                | `^7.29.7`            | `^7.29.9`            | [8.0.7](https://www.npmjs.com/package/@babel/eslint-parser/v/8.0.7)                | Babel compiler peer requirement         |
| `@babel/parser`                       | `^7.29.8`            | `^7.29.12`           | [8.1.0](https://www.npmjs.com/package/@babel/parser/v/8.1.0)                       | User-selected Babel 7 parser            |
| `@babel/preset-env`                   | `^7.29.7`            | `^7.29.7`            | [8.0.7](https://www.npmjs.com/package/@babel/preset-env/v/8.0.7)                   | Babel compiler compatibility            |
| `@emulsify/cli`                       | `^2.4.1`             | `^2.4.1`             | [2.4.1](https://www.npmjs.com/package/@emulsify/cli/v/2.4.1)                       | Latest stable                           |
| `@eslint/js`                          | `^9.39.5`            | `^9.39.5`            | [10.0.1](https://www.npmjs.com/package/@eslint/js/v/10.0.1)                        | ESLint plugin compatibility             |
| `@forumone/twig-drupal-filters`       | `^4.0.0`             | `^4.0.0`             | [4.0.0](https://www.npmjs.com/package/@forumone/twig-drupal-filters/v/4.0.0)       | Latest stable                           |
| `@mlnop/vite-plugin-sass-glob-import` | `^6.2.0`             | `^6.2.0`             | [6.2.0](https://www.npmjs.com/package/@mlnop/vite-plugin-sass-glob-import/v/6.2.0) | Latest stable                           |
| `@storybook/addon-a11y`               | `10.6.4`             | `10.6.5`             | [10.6.5](https://www.npmjs.com/package/@storybook/addon-a11y/v/10.6.5)             | Latest stable                           |
| `@storybook/addon-links`              | `10.6.4`             | `10.6.5`             | [10.6.5](https://www.npmjs.com/package/@storybook/addon-links/v/10.6.5)            | Latest stable                           |
| `@storybook/addon-themes`             | `10.6.4`             | `10.6.5`             | [10.6.5](https://www.npmjs.com/package/@storybook/addon-themes/v/10.6.5)           | Latest stable                           |
| `@storybook/react`                    | `10.6.4`             | `10.6.5`             | [10.6.5](https://www.npmjs.com/package/@storybook/react/v/10.6.5)                  | Latest stable                           |
| `@storybook/react-vite`               | `10.6.4`             | `10.6.5`             | [10.6.5](https://www.npmjs.com/package/@storybook/react-vite/v/10.6.5)             | Latest stable                           |
| `@vituum/vite-plugin-twig`            | `^2.0.1`             | `^2.0.1`             | [2.0.1](https://www.npmjs.com/package/@vituum/vite-plugin-twig/v/2.0.1)            | Latest stable                           |
| `autoprefixer`                        | `^10.5.6`            | `^10.6.2`            | [10.6.2](https://www.npmjs.com/package/autoprefixer/v/10.6.2)                      | Latest stable                           |
| `axe-core`                            | `^4.13.0`            | `^4.14.0`            | [4.14.0](https://www.npmjs.com/package/axe-core/v/4.14.0)                          | Latest stable                           |
| `babel-preset-minify`                 | `^0.5.2`             | `^0.5.2`             | [0.5.2](https://www.npmjs.com/package/babel-preset-minify/v/0.5.2)                 | Latest stable                           |
| `concurrently`                        | `^10.0.5`            | `^10.0.6`            | [10.0.6](https://www.npmjs.com/package/concurrently/v/10.0.6)                      | Latest stable                           |
| `eslint`                              | `^9.39.5`            | `^9.39.5`            | [10.14.0](https://www.npmjs.com/package/eslint/v/10.14.0)                          | ESLint plugin compatibility             |
| `eslint-config-prettier`              | `^10.1.8`            | `^10.1.8`            | [10.1.8](https://www.npmjs.com/package/eslint-config-prettier/v/10.1.8)            | Latest stable                           |
| `eslint-plugin-import`                | `^2.32.0`            | `^2.32.0`            | [2.32.0](https://www.npmjs.com/package/eslint-plugin-import/v/2.32.0)              | Latest stable                           |
| `eslint-plugin-jest`                  | `^29.16.6`           | `^29.17.0`           | [29.17.0](https://www.npmjs.com/package/eslint-plugin-jest/v/29.17.0)              | Latest stable                           |
| `eslint-plugin-prettier`              | `^5.5.6`             | `^5.5.7`             | [5.5.7](https://www.npmjs.com/package/eslint-plugin-prettier/v/5.5.7)              | Latest stable                           |
| `eslint-plugin-security`              | `^4.0.1`             | `^4.2.1`             | [4.2.1](https://www.npmjs.com/package/eslint-plugin-security/v/4.2.1)              | Latest stable                           |
| `eslint-plugin-storybook`             | `10.6.4`             | `10.6.5`             | [10.6.5](https://www.npmjs.com/package/eslint-plugin-storybook/v/10.6.5)           | Latest stable                           |
| `glob`                                | `^13.0.6`            | `^14.0.3`            | [14.0.3](https://www.npmjs.com/package/glob/v/14.0.3)                              | Latest stable                           |
| `jest`                                | `^30.5.1`            | `^30.5.2`            | [30.5.2](https://www.npmjs.com/package/jest/v/30.5.2)                              | Latest stable                           |
| `jest-environment-jsdom`              | `^30.5.1`            | `^30.5.2`            | [30.5.2](https://www.npmjs.com/package/jest-environment-jsdom/v/30.5.2)            | Latest stable                           |
| `js-yaml`                             | `^5.4.1`             | `^5.5.0`             | [5.5.0](https://www.npmjs.com/package/js-yaml/v/5.5.0)                             | Latest stable                           |
| `normalize.css`                       | `^8.0.1`             | `^8.0.1`             | [8.0.1](https://www.npmjs.com/package/normalize.css/v/8.0.1)                       | Latest stable                           |
| `open-cli`                            | `^9.0.0`             | `^9.0.0`             | [9.0.0](https://www.npmjs.com/package/open-cli/v/9.0.0)                            | Latest stable                           |
| `pa11y`                               | `^10.0.0`            | `^10.0.0`            | [10.0.0](https://www.npmjs.com/package/pa11y/v/10.0.0)                             | Latest stable                           |
| `postcss`                             | `^8.5.28`            | `^8.5.32`            | [8.5.32](https://www.npmjs.com/package/postcss/v/8.5.32)                           | Latest stable                           |
| `postcss-scss`                        | `^4.0.9`             | `^4.0.9`             | [4.0.9](https://www.npmjs.com/package/postcss-scss/v/4.0.9)                        | Latest stable                           |
| `sass`                                | `^1.104.0`           | `^1.107.1`           | [1.107.1](https://www.npmjs.com/package/sass/v/1.107.1)                            | Latest stable                           |
| `storybook`                           | `10.6.4`             | `10.6.5`             | [10.6.5](https://www.npmjs.com/package/storybook/v/10.6.5)                         | Latest stable                           |
| `stylelint`                           | `^17.15.0`           | `^17.16.0`           | [18.0.0](https://www.npmjs.com/package/stylelint/v/18.0.0)                         | Node and Stylelint plugin compatibility |
| `stylelint-config-standard-scss`      | `^17.0.0`            | `^17.0.0`            | [17.0.0](https://www.npmjs.com/package/stylelint-config-standard-scss/v/17.0.0)    | Latest stable                           |
| `stylelint-prettier`                  | `^5.0.3`             | `^5.0.3`             | [5.0.3](https://www.npmjs.com/package/stylelint-prettier/v/5.0.3)                  | Latest stable                           |
| `stylelint-selector-bem-pattern`      | `^5.0.0`             | `^5.0.0`             | [5.0.0](https://www.npmjs.com/package/stylelint-selector-bem-pattern/v/5.0.0)      | Latest stable                           |
| `twig`                                | `^3.0.0`             | `^3.0.0`             | [3.0.0](https://www.npmjs.com/package/twig/v/3.0.0)                                | Latest stable                           |
| `vite`                                | `^8.3.0`             | `^8.3.5`             | [8.3.5](https://www.npmjs.com/package/vite/v/8.3.5)                                | Latest stable                           |

## Development dependencies

| Package                                     | Previous requirement | Selected requirement | Latest stable                                                                              | Selection     |
| ------------------------------------------- | -------------------- | -------------------- | ------------------------------------------------------------------------------------------ | ------------- |
| `@commitlint/cli`                           | `^21.2.2`            | `^21.2.4`            | [21.2.4](https://www.npmjs.com/package/@commitlint/cli/v/21.2.4)                           | Latest stable |
| `@commitlint/config-conventional`           | `^21.2.2`            | `^21.2.4`            | [21.2.4](https://www.npmjs.com/package/@commitlint/config-conventional/v/21.2.4)           | Latest stable |
| `@semantic-release/commit-analyzer`         | `^13.0.1`            | `^13.0.1`            | [13.0.1](https://www.npmjs.com/package/@semantic-release/commit-analyzer/v/13.0.1)         | Latest stable |
| `@semantic-release/github`                  | `^12.0.9`            | `^12.0.10`           | [12.0.10](https://www.npmjs.com/package/@semantic-release/github/v/12.0.10)                | Latest stable |
| `@semantic-release/npm`                     | `^13.1.5`            | `^13.2.0`            | [13.2.0](https://www.npmjs.com/package/@semantic-release/npm/v/13.2.0)                     | Latest stable |
| `@semantic-release/release-notes-generator` | `^14.1.1`            | `^14.1.1`            | [14.1.1](https://www.npmjs.com/package/@semantic-release/release-notes-generator/v/14.1.1) | Latest stable |
| `husky`                                     | `^9.1.7`             | `^9.1.7`             | [9.1.7](https://www.npmjs.com/package/husky/v/9.1.7)                                       | Latest stable |
| `lint-staged`                               | `^17.5.1`            | `^17.6.0`            | [17.6.0](https://www.npmjs.com/package/lint-staged/v/17.6.0)                               | Latest stable |
| `puppeteer`                                 | `^25.10.0`           | `^25.16.0`           | [25.16.0](https://www.npmjs.com/package/puppeteer/v/25.16.0)                               | Latest stable |
| `react`                                     | `^19.3.0`            | `^19.3.1`            | [19.3.1](https://www.npmjs.com/package/react/v/19.3.1)                                     | Latest stable |
| `react-dom`                                 | `^19.3.0`            | `^19.3.1`            | [19.3.1](https://www.npmjs.com/package/react-dom/v/19.3.1)                                 | Latest stable |
| `semantic-release`                          | `^25.0.9`            | `^25.0.9`            | [25.0.9](https://www.npmjs.com/package/semantic-release/v/25.0.9)                          | Latest stable |

## Consumer peers and optional dependencies

React and React DOM retain support for both React 18 and React 19 consumers.
The development fixtures use the latest stable React 19 patch release.

| Peer        | Previous requirement   | Selected requirement   | Latest stable |
| ----------- | ---------------------- | ---------------------- | ------------- |
| `react`     | `^18.0.0 \|\| ^19.0.0` | `^18.0.0 \|\| ^19.0.0` | 19.3.1        |
| `react-dom` | `^18.0.0 \|\| ^19.0.0` | `^18.0.0 \|\| ^19.0.0` | 19.3.1        |

Core declares no `optionalDependencies`.

## Compatibility decisions

### Babel compiler and ESLint parser

Keep `@babel/core` and `@babel/preset-env` at `^7.29.7`. Core's existing Babel
configuration uses the latest `babel-preset-minify`, version `0.5.2`. Its
`babel-helper-mark-eval-scopes` helper calls `traverse()` on a scope. Babel 8
removed `Scope.prototype.traverse`, so the current integration fails under Babel
8 with `TypeError: path.traverse is not a function`. The helper needs an upstream
release before this compiler upgrade can use the existing integration.
[Babel API migration](https://babeljs.io/docs/v8-migration-api#babeltraverse),
[minify helper source](https://raw.githubusercontent.com/babel/minify/master/packages/babel-helper-mark-eval-scopes/src/index.js),
[minify registry release](https://www.npmjs.com/package/babel-preset-minify/v/0.5.2)

Jest's Babel preset also brings `babel-preset-current-node-syntax@1.2.0` and
Babel 7 syntax plugins. The syntax preset admits Babel 8, but individual plugins,
including `@babel/plugin-syntax-import-attributes`, require Babel core 7. A Babel
8 compiler would leave those upstream peer requirements unsatisfied.
[Syntax preset metadata](https://registry.npmjs.org/babel-preset-current-node-syntax/1.2.0),
[syntax plugin metadata](https://registry.npmjs.org/@babel/plugin-syntax-import-attributes/7.29.7)

Select `@babel/eslint-parser@^7.29.9`, the latest compatible stable release. The
latest parser integration, `8.0.7`, requires `@babel/core@^8.0.0`, tying its
upgrade to the compiler blockers above.
[Parser 8 metadata](https://registry.npmjs.org/@babel/eslint-parser/8.0.7),
[parser 7 metadata](https://registry.npmjs.org/@babel/eslint-parser/7.29.9)

### Standalone Babel parser

Select `@babel/parser@^7.29.12` at the user's request. A clean Jest configuration
migration for standalone parser 8 was verified during this review. The user
chose to keep parser 7 for this release, while raising its minimum to the latest
stable 7.x version. Parser 8.1.0 remains a future migration choice.
[Babel parser migration](https://babeljs.io/docs/v8-migration-api#babelparser),
[parser 7.29.12 metadata](https://registry.npmjs.org/@babel/parser/7.29.12)

### ESLint

Keep ESLint and `@eslint/js` at `^9.39.5`. The latest
`eslint-plugin-import@2.32.0` supports ESLint through version 9, and the selected
`@babel/eslint-parser@7.29.9` also supports ESLint through version 9. Upgrading
ESLint to 10 would exceed both integrations' declared peer ranges. Keep
`@eslint/js` on the corresponding major alongside ESLint.
[Import plugin metadata](https://registry.npmjs.org/eslint-plugin-import/2.32.0),
[Babel parser metadata](https://registry.npmjs.org/@babel/eslint-parser/7.29.9),
[ESLint 10 migration](https://eslint.org/docs/latest/use/migrate-to-10.0.0)

### Stylelint

Select `stylelint@^17.16.0`. Stylelint 18 requires
`^22.22.2 || ^24.15.0 || >=26.0.0`, excluding Core's supported Node 24.13.0
minimum. Latest `stylelint-config-standard-scss@17.0.0` and
`stylelint-selector-bem-pattern@5.0.0` require Stylelint 17. The latest SCSS
plugin, `stylelint-scss@7.4.0`, supports Stylelint 16 and 17. These upstream peer
requirements also prevent the major upgrade.
[Stylelint 18 migration](https://stylelint.io/migration-guide/to-18/#removed-support-for-end-of-life-and-older-versions-of-nodejs),
[standard SCSS metadata](https://registry.npmjs.org/stylelint-config-standard-scss/17.0.0),
[BEM plugin metadata](https://registry.npmjs.org/stylelint-selector-bem-pattern/5.0.0),
[SCSS plugin metadata](https://registry.npmjs.org/stylelint-scss/7.4.0)

The latest `stylelint-prettier@5.0.3` still uses `context.fix` for formatting
repairs. Stylelint 18 removes that API, so this integration also needs an
upstream migration to preserve its autofix behavior.
[Plugin source](https://raw.githubusercontent.com/prettier/stylelint-prettier/v5.0.3/index.js),
[Stylelint API migration](https://stylelint.io/migration-guide/to-18/#removed-contextfix-property)

### Glob

Upgrade `glob` from `^13.0.6` to `^14.0.3`. Core uses the supported `globSync`
and `escape` APIs. Its callers use relative ignore patterns and do not use the
removed debug option or changed internal pattern APIs. Glob 14's Node engine
range admits Node 24.13.0. Its minimatch 11 dependency replaces regular-expression
matching with a nonrecursive matcher.
[Glob 14 changelog](https://raw.githubusercontent.com/isaacs/node-glob/v14.0.3/changelog.md),
[Glob API](https://github.com/isaacs/node-glob/tree/v14.0.3#usage),
[Glob registry metadata](https://registry.npmjs.org/glob/14.0.3)

## Package resolution and installer approvals

The lockfile is regenerated through npm. Resolution uses supported published
packages and their dependency ranges, with no overrides, arbitrary transitive
pins, or third-party source patches introduced for these updates. The existing
exact Storybook family requirements move together to `10.6.5`.

Installer approvals remain restricted to exact reviewed versions. Puppeteer
moves from `25.10.0` to `25.16.0`, and esbuild moves from `0.28.1` to `0.28.2`.
The existing `@parcel/watcher@2.6.0` and `fsevents@2.3.3` approvals remain. The
obsolete `unrs-resolver@1.12.2` approval is removed because the regenerated
lockfile selects resolver 1.13.0, which has no install lifecycle script.
[Puppeteer release](https://github.com/puppeteer/puppeteer/releases/tag/puppeteer-v25.16.0),
[esbuild release](https://github.com/evanw/esbuild/releases/tag/v0.28.2),
[resolver metadata](https://registry.npmjs.org/unrs-resolver/1.13.0)

## Remaining audit and deprecation findings

The regenerated lockfile reduces npm's audit from 89 to 77 affected package
records: 1 low, 72 moderate, 2 high and 2 critical. These counts include parent
packages affected by a vulnerable child, rather than 77 separate advisories.

| Affected dependency                                                                                  | Owning integration and remaining constraint                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `simple-git@3.36.0`, `@simple-git/argv-parser@1.1.1` (critical), and affected `@emulsify/cli` (high) | Latest `@emulsify/cli@2.4.1` requires `simple-git@^3.36.0`. Fixed simple-git 4 is outside that range; npm reports no available fix through the CLI. Core retains the existing local `emulsify` binary contract.                      |
| `undici@6.29.0` (high), `ip-address@10.7.2` (moderate)                                               | Latest `@semantic-release/npm@13.2.0` selects npm 11.21.1, which bundles these versions. npm 12 is outside the release plugin's `npm@^11.6.2` dependency range. Supported range updates do not replace bundled package contents.     |
| Nested `glob` and `minimatch` (moderate)                                                             | Latest Jest, Sass glob integration, Storybook docgen, ESLint and release tooling retain older major ranges. Core's direct Glob 14/minimatch 11 update fixes its own path without forcing unsupported majors into those integrations. |
| `deepmerge@4.3.1` (low)                                                                              | Latest Jest's configuration integration retains deepmerge 4. npm's suggested Jest 29 downgrade would roll back the maintained Jest 30 contract.                                                                                      |

See the [CLI manifest](https://registry.npmjs.org/@emulsify/cli/2.4.1),
[simple-git advisory](https://github.com/advisories/GHSA-x6jw-m9v5-85vh),
[argv-parser advisory](https://github.com/advisories/GHSA-v5rq-49vh-5v5c),
[release plugin manifest](https://registry.npmjs.org/@semantic-release/npm/13.2.0),
[npm 11 manifest](https://registry.npmjs.org/npm/11.21.1),
[Jest config manifest](https://registry.npmjs.org/jest-config/30.5.2),
[Glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), and
[minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).

Lifecycle-enabled installation still prints upstream deprecations for
`glob@10.5.0`, `whatwg-encoding@3.1.1` and `eslint@9.39.5`. Jest and Storybook's
docgen integration retain Glob 10; jsdom through `jest-environment-jsdom` retains
whatwg-encoding; ESLint 10 remains blocked by the published peer requirements
above. These warnings remain visible. Resolving them requires compatible
upstream releases rather than root overrides or dependency source patches.
