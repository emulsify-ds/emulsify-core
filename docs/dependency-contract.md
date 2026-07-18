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
`config/consumer-contract.json`. Its `dependencies` object maps each contract
package to the generated-consumer script names that need it, its `notes` object
records why the package is intentionally kept, and its `fixtures` and
`reactMatrix` objects connect that metadata to executable compatibility checks.

## Executable Consumer Fixtures

Run every packed-consumer check with:

```sh
npm run fixtures:consumer
```

The runner creates one Core tarball, copies each representative consumer into a
clean temporary project, and installs that tarball with npm's normal installer.
It rejects an installed Core package that is a symlink or resolves into the
source checkout. It also verifies that each contract dependency is available
from the consumer's flat `node_modules`, runs the fixture's finite verification
scripts, checks expected build output and Storybook IDs, and removes the
temporary projects and tarball whether the suite succeeds or fails. Captured
child-process output is printed when a fixture fails.

The checked-in fixtures intentionally contain only the project structure and
scripts needed to preserve the dependency contract:

| Fixture           | Consumer model                                    | Finite scripts executed automatically               |
| ----------------- | ------------------------------------------------- | --------------------------------------------------- |
| `whisk-drupal`    | `emulsify-ds/emulsify-drupal/whisk`               | `lint-js`, `lint-styles`, `test`, and `a11y`        |
| `none`            | A generated `none` platform theme                 | `build`                                             |
| `wordpress-twig`  | `emulsify-ds/emulsify-wordpress/whisk`            | `build`                                             |
| `mixed-storybook` | A mixed Twig, React, and custom-element Storybook | `storybook-build` with each supported React version |

The Drupal fixture's `a11y` command first performs its Vite and Storybook builds,
serves the built Storybook on a loopback HTTP origin, and runs Pa11y with axe
against the configured Twig story in a browser. This is an executable
accessibility check, not only a dependency-resolution assertion. Its Jest test
also proves the generated consumer can use Core's hoisted Jest and jsdom stack.

Long-running or side-effecting scripts such as `develop`, `vite`, `storybook`,
`coverage`, and `twatch` remain present in the representative Whisk manifest so
the metadata test can prove that every script named by the dependency contract
still exists. The fixture runner executes only the finite scripts listed in
each fixture's `verify` field.

### React Peer Matrix

The mixed Storybook fixture is built twice from the installed Core tarball:
once with React and React DOM 18.3.1, and once with React and React DOM 19.2.7.
Each build must contain the expected Twig, React, and autonomous custom-element
stories. This focused matrix checks both supported peer ranges without
duplicating the full repository test suite.

Run one matrix entry locally with:

```sh
npm run fixtures:consumer -- --fixture mixed-storybook --react 18
npm run fixtures:consumer -- --fixture mixed-storybook --react 19
```

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

The fixture directories are deliberately small snapshots, not live checkouts of
the projects they model. When a generator changes its package scripts or
project structure:

1. Compare the generated output with the model named by the fixture's `model`
   field in `config/consumer-contract.json`.
2. Update the minimal package manifest or project files under
   `.github/fixtures/consumer/` and the reused source fixture only where the
   generated consumer actually changed. Do not add a direct dependency merely
   to make the fixture pass if the real consumer relies on Core to provide it.
3. Update the dependency-to-script mapping, finite `verify` list, expected
   output, and Storybook IDs in `config/consumer-contract.json` as needed.
4. Run the affected fixture, then run the complete suite:

   ```sh
   npm run fixtures:consumer -- --fixture whisk-drupal
   npm run fixtures:consumer
   ```

Before removing a dependency that appears unused in Core source, verify both
Core and known generated consumers. At minimum, check Whisk in
`emulsify-ds/emulsify-drupal`, Compound, and Emulsify UI Kit for scripts,
imports, and docs that rely on the package. If a package is kept for consumer
compatibility, add it to `config/consumer-contract.json` with a one-line note
and fixture coverage. If verification proves it unused, remove it from
`dependencies`, update the lockfile and contract metadata, and run the packed
consumer suite in the same change.
