# Dependency Contract

Emulsify Core is a tooling bundle, not only a library imported by application
code. Generated themes such as Whisk intentionally declare one dependency:
`@emulsify/core`. Their npm scripts then call binaries and shared config files
that npm exposes through the flat `node_modules` layout created by the npm
installer.

That makes many entries in `package.json#dependencies` part of Core's public
runtime contract for generated themes. They must stay in `dependencies`, not
`devDependencies`, even when Core's own source appears to use them only from
config files or not at all. Removing one can break a generated theme whose
script resolves the package from the hoisted install.

The machine-readable source for this contract is
`config/consumer-contract.json`. Its `dependencies` object maps each
contract package to the Whisk script names that need it, and its `notes` object
records why the package is intentionally kept.

## Whisk Evidence

Whisk's `package.json` declares only:

```json
{
  "dependencies": {
    "@emulsify/core": "^4.0.0"
  }
}
```

The same manifest invokes hoisted tooling from scripts:

| Whisk script                   | Hoisted command or Core config                                               | Contract packages                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `develop`                      | `concurrently --raw --no-shell npm:vite npm:storybook`                       | `concurrently`, plus the `vite` and `storybook` contract packages below.                                                                            |
| `build`, `vite`                | `vite build --config node_modules/@emulsify/core/config/vite/vite.config.js` | `vite`, `sass`, `postcss`, `autoprefixer`, `babel-preset-minify`, and the build-time CSS packages compiled by Core.                                 |
| `storybook`, `storybook-build` | `storybook ... -c node_modules/@emulsify/core/.storybook`                    | `storybook`, `@storybook/react`, `@storybook/react-vite`, `@storybook/addon-a11y`, `@storybook/addon-links`, `@storybook/addon-themes`, `axe-core`. |
| `lint-js`                      | `eslint --config config/emulsify-core/eslint.config.js ...`                  | `eslint`, `@eslint/js`, `@babel/core`, `@babel/eslint-parser`, and the ESLint config/plugin packages listed in the contract manifest.               |
| `lint-styles`                  | `stylelint --config config/emulsify-core/stylelintrc.config.json ...`        | `stylelint`, `stylelint-config-standard-scss`, `stylelint-prettier`, `stylelint-selector-bem-pattern`, `postcss-scss`.                              |
| `test`, `coverage`, `twatch`   | `jest ... --config ./config/jest.config.js`                                  | `jest`, `jest-environment-jsdom`, `@babel/core`, `@babel/preset-env`; `coverage` also invokes `open-cli`.                                           |
| `a11y`                         | `node_modules/@emulsify/core/scripts/a11y.js -r` after `storybook-build`     | `pa11y`, `axe-core`, plus the Storybook build contract packages.                                                                                    |

`normalize.css` is also part of the consumer contract. It is not imported by
Core source, but verified generated consumers import it from SCSS:
Compound uses `@use "~normalize.css/normalize"` and Emulsify UI Kit uses
`@use "../../../node_modules/normalize.css/normalize.css"`. Those styles are
compiled by the same Core Vite and Storybook scripts.

## Installer Assumption

This contract assumes npm's default flat `node_modules` layout. npm installs
`@emulsify/core` and exposes dependency binaries/config packages in a way that
lets generated-theme scripts run without repeating every tool dependency in the
theme's own `package.json`.

Package managers that do not provide that layout are unsupported for generated
themes using the one-dependency Whisk pattern. In practice, pnpm's isolated
linker and Yarn Plug'n'Play require the consuming project to declare every tool
package it calls directly. That is outside Core's generated-theme contract. See
the [Known Limitations](../README.md#known-limitations) notes for the support
boundary.

## Changing The Contract

Before removing a dependency that appears unused in Core source, verify both
Core and known generated consumers. At minimum, check Whisk in
`emulsify-ds/emulsify-drupal`, Compound, and Emulsify UI Kit for scripts,
imports, and docs that rely on the package. If a package is kept for consumer
compatibility, add it to `config/consumer-contract.json` with a one-line note.
If verification proves it unused, remove it from `dependencies` and update the
lockfile in the same change.
