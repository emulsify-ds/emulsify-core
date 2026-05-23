![Emulsify Core Design System](https://github.com/emulsify-ds/.github/blob/6bd435be881bd820bddfa05d88905efe29176a0a/assets/images/header.png)

# Emulsify Core

An open-source toolset for creating and implementing design systems.

**Emulsify Core** provides a [Storybook](https://storybook.js.org/) component library and a [Vite](https://vite.dev/) development environment. It is meant to make project setup and ongoing development easier by bundling reusable configuration for Twig-based themes and standalone projects.

## Twig rendering

Emulsify Core's Twig integration is platform-agnostic. The shared Vite config uses [`@vituum/vite-plugin-twig`](https://github.com/vituum/vite-plugin-twig) for generic Twig rendering and an Emulsify-owned Vite plugin to keep Storybook component imports working as render functions, including `*.twig` and `*.twig?twig` imports.

Drupal-specific Twig helpers such as `twig-drupal-filters`, `bem-twig-extension`, and `add-attributes-twig-extension` are still registered in Storybook as compatibility extensions for existing component libraries. They are not the core renderer and can coexist with Drupal, WordPress, Craft CMS, or other Twig-based project integrations.

Drupal component mirroring remains intentionally Drupal-specific: when a Drupal project builds from `src/`, `dist/components/**` is mirrored back to the root `components/` directory for Drupal SDC compatibility. Generic, WordPress, Craft CMS, and other platform builds do not use that mirroring behavior by default.

## Installation and usage
Installation and configuration is set up by the provided project starter or platform package. Emulsify Drupal is the current reference integration, and the core Vite/Twig configuration is intended to support additional Twig-based platforms without changing the renderer.

### Manual installation
- `npm install @emulsify/core` within your repository or project theme.
- Copy the provided `npm run` scripts from [Emulsify Drupal's package.json](https://github.com/emulsify-ds/emulsify-drupal/blob/main/whisk/package.json#L15)
- Copy the contents of `whisk/config/emulsify-core/` from [Emulsify Drupal](https://github.com/emulsify-ds/emulsify-drupal/tree/main/whisk/config/emulsify-core) into your project so `config/` exists at the root of your repository or project theme. The files within `config/` allow you to extend or overwrite configuration provided by Emulsify Core.

### Common Scripts

Run `nvm use` prior to running any of the following commands to verify you are using the supported Node version.
(Each is prefixed with `npm run `)

**develop**
Starts and instance of storybook, watches for any files changes, recompiles CSS/JS, and live reloads storybook assets.

**lint**
Lints all JS/SCSS within your components and reports any violations.

**lint-fix**
Automatically fixes any simple violations.

**prettier**
Outputs any code formatting violations.

**prettier-fix**
Automatically fixes any simple code formatting violations.

**storybook-build**
Builds a static output of the storybook instance.


### Quick Links

- [Emulsify Homepage](https://www.emulsify.info/)

## Demo

1. [Storybook](http://storybook.emulsify.info/)

## Contributing

### [Code of Conduct](https://github.com/emulsify-ds/emulsify-drupal/blob/master/CODE_OF_CONDUCT.md)

The project maintainers have adopted a Code of Conduct that we expect project participants to adhere to. Please read the full text so that you can understand what actions will and will not be tolerated.

### Contribution Guide

Please also follow the issue template and pull request templates provided. See below for the correct places to post issues:

1. [Emulsify Drupal](https://github.com/emulsify-ds/emulsify-drupal/issues)
2. [Emulsify Twig Extensions](https://github.com/emulsify-ds/emulsify-twig-extensions/issues)
3. [Emulsify Tools (Drupal module)](https://www.drupal.org/project/issues/emulsify_tools)

### Committing Changes

To facilitate automatic semantic release versioning, we utilize the [Conventional Changelog](https://github.com/conventional-changelog/conventional-changelog) standard through Commitizen. Follow these steps when commiting your work to ensure semantic release can version correctly.

1. Stage your changes, ensuring they encompass exactly what you wish to change, no more.
2. Run the `commit` script via `yarn commit` or `npm run commit` and follow the prompts to craft the perfect commit message.
3. Your commit message will be used to create the changelog for the next version that includes that commit.

## Author

Emulsify&reg; is a product of [Four Kitchens](https://fourkitchens.com).

## Contributors

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="16.66%"><a href="https://github.com/callinmullaney"><img src="https://avatars.githubusercontent.com/u/369018?v=4?s=100" width="100px;" alt="Callin Mullaney"/><br /><sub><b>Callin Mullaney</b></sub></a><br /><a href="https://github.com/fourkitchens/emulsify-core/commits?author=callinmullaney" title="Code">💻</a> <a href="https://github.com/fourkitchens/emulsify-core/commits?author=callinmullaney" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="16.66%"><a href="https://github.com/amazingrando"><img src="https://avatars.githubusercontent.com/u/409903?v=4?s=100" width="100px;" alt="Randy Oest"/><br /><sub><b>Randy Oest</b></sub></a><br /><a href="https://github.com/fourkitchens/emulsify-core/commits?author=amazingrando" title="Code">💻</a> <a href="https://github.com/fourkitchens/emulsify-core/commits?author=amazingrando" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="16.66%"><a href="https://github.com/robherba"><img src="https://avatars.githubusercontent.com/u/9342274?v=4?s=100" width="100px;" alt="Roberto Hernandez"/><br /><sub><b>Roberto Hernandez</b></sub></a><br /><a href="https://github.com/fourkitchens/emulsify-core/commits?author=robherba" title="Code">💻</a></td>
      <td align="center" valign="top" width="16.66%"><a href="https://github.com/dependabot"><img src="https://avatars.githubusercontent.com/u/49699333?v=4?s=100" width="100px;" alt="Dependabot"/><br /><sub><b>Dependabot</b></sub></a><br /><a href="#maintenance-dependabot" title="Maintenance">🚧</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind welcome!
