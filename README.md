![Emulsify Core Design System](https://github.com/emulsify-ds/.github/blob/6bd435be881bd820bddfa05d88905efe29176a0a/assets/images/header.png)

# Emulsify Core

An open-source toolset for creating and implementing design systems.

**Emulsify Core** provides shared [Vite](https://vite.dev/) build configuration and a [Storybook](https://storybook.js.org/) component library setup for component-driven development. Twig-based components and React components are both supported authoring models. A project can be Twig-first, React-first, or intentionally mixed.

## How Emulsify Core Works

- Vite builds project JavaScript, Sass/CSS, Twig templates, component metadata, and static component assets.
- Storybook uses the React/Vite framework.
- Twig files can render in React-based Storybook through `renderTwig()`.
- React components render through Storybook's React/Vite support.
- Twig and React stories can coexist in the same Storybook instance.
- `project.emulsify.json` is the source of truth for platform and structure configuration.
- Platform-specific behavior is controlled by adapters instead of being assumed globally.
- Node.js 24 or later is required.

## Project Evolution

Emulsify Core has grown through each major release while keeping the same practical goal: make component-library tooling easier to share across real projects.

- `1.x` established Emulsify Core as a reusable package for Storybook, Webpack, linting, a11y checks, project overrides, and asset handling.
- `2.x` expanded component structure support, improved Drupal SDC compatibility, upgraded Storybook, and made more project files configurable from consuming projects.
- `3.x` modernized the runtime around ESM and Node 24, continued Storybook and dependency upgrades, improved component asset copying, and strengthened compatibility for existing Drupal-oriented builds.
- The current release moves the build system to Vite, runs Storybook on React/Vite, supports Twig and React stories side by side, and normalizes platform and project-structure behavior through `project.emulsify.json`.

The latest version is the next evolution of that work: faster builds, clearer public APIs, less global Drupal assumption, and a broader foundation for CMS themes, standalone UI libraries, and mixed component systems.

See [Version Evolution](docs/version-evolution.md) for more release history.

## Authoring Models

Twig and React are equally valid ways to build component libraries with Emulsify Core. The right authoring model depends on the consuming project:

- Use Twig for CMS themes and server-rendered template systems. Drupal has a dedicated adapter today; Craft CMS and WordPress + Timber can use the `none` adapter unless a project adds platform-specific behavior.
- Use React for standalone UI libraries, application components, or projects that already use React.
- Use mixed Twig and React when a design system needs to document both CMS-rendered and JavaScript-rendered components in the same Storybook instance.

See [Component Authoring](docs/component-authoring.md) for Twig, React, mixed Storybook, and shared Sass examples.

## Basic Usage

Installation and project scripts are usually provided by a starter or platform integration. Manual setup starts with:

```sh
npm install @emulsify/core
```

Every project should provide a `project.emulsify.json` file at the project root:

```json
{
  "project": {
    "platform": "none",
    "name": "example",
    "machineName": "example"
  }
}
```

Common project scripts call the shared Emulsify Core Vite and Storybook config:

- `storybook`: starts Storybook development.
- `storybook-build`: builds static Storybook output.
- `build`: runs the Vite build for JS, CSS, copied Twig templates, component metadata, and static component assets.
- `lint`: lints maintained project source.

## Documentation

The documentation is split by task:

| Topic                                                     | Use This When                                                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [Version Evolution](docs/version-evolution.md)            | Understanding how Emulsify Core has evolved across major releases.                                                    |
| [Component Authoring](docs/component-authoring.md)        | Choosing Twig, React, or mixed Storybook authoring and comparing component examples.                                  |
| [Storybook](docs/storybook.md)                            | Rendering Twig stories, using `renderTwig()`, understanding Twig runtime helpers, and mixing Twig with React stories. |
| [Project Structure And Output](docs/project-structure.md) | Configuring `src/components`, root `./components`, `variant.structureImplementations`, and expected output paths.     |
| [Platform Adapters](docs/platform-adapters.md)            | Understanding `none`, `drupal`, platform resolution order, and Drupal SDC behavior.                                   |
| [Extension Points](docs/extension-points.md)              | Adding Vite plugins, Tailwind CSS, Storybook preview overrides, and other framework tooling.                          |
| [Performance](docs/performance.md)                        | Understanding sourcemaps, eager Twig imports, Tailwind scanning, copied files, and fixture validation.                |
| [Native Twig Extensions](docs/native-twig-extensions.md)  | Using `bem()`, `add_attributes()`, and `switch/case/default/endswitch` in Twig.js.                                    |
| [Release Verification](docs/release.md)                   | Running 4.x release checks, tarball smoke tests, and semantic-release dry runs before publishing.                     |
| [Migration](docs/migration-4x.md)                         | Upgrading from earlier versions while preserving existing structures.                                                 |

## Known Limitations

- Implemented platform adapters are currently `none` and `drupal`. WordPress + Timber and Craft CMS are supported as Twig-oriented use cases through the `none` adapter today. Dedicated adapters are future opportunities. See [Platform Adapters](docs/platform-adapters.md).
- Storybook's Twig resolver eagerly imports Twig modules and raw Twig source. This is reliable for `include()` and `source()`, but large Twig libraries should keep Storybook source roots intentional. See [Performance](docs/performance.md).
- Production sourcemaps are enabled by default unless a project overrides Vite config through `config/emulsify-core/vite/plugins.*`. See [Performance](docs/performance.md).
- Project extensions use the public `config/emulsify-core` directory: `config/emulsify-core/vite/plugins.*` for Vite, `config/emulsify-core/storybook/...` for Storybook, and `config/emulsify-core/a11y.config.js` for a11y. See [Extension Points](docs/extension-points.md).
- Webpack-specific customizations must be migrated manually to Vite plugins or `extendConfig()`. See [Migration](docs/migration-4x.md).
- Drupal SDC mirroring only applies when the Drupal adapter and SDC settings are enabled. `none` projects should expect output to remain in `dist/`. See [Platform Adapters](docs/platform-adapters.md).

## Supported Project Shapes

Release-readiness coverage validates:

- Drupal SDC projects using `src/components`.
- `none` platform Twig projects using `src/components`.
- Root `./components` projects.
- Projects using multiple `variant.structureImplementations`.
- Mixed Twig + React Storybook projects.

WordPress + Timber and Craft CMS are Twig-based project use cases that can use the `none` adapter today. Dedicated adapters for those platforms are future opportunities. The implemented adapters in this package are currently `none` and `drupal`.

## Public Imports

Emulsify Core exposes stable public package paths:

```js
import { renderTwig } from '@emulsify/core/storybook';
import { registerTwigExtensions } from '@emulsify/core/extensions/twig';
import { defineReactExtension } from '@emulsify/core/extensions/react';
```

`defineReactExtension` is reserved for future React extension support. It currently returns the input unchanged. Adopting the import path is safe; the runtime is intentionally a no-op until the registry lands. See [Extension Points](docs/extension-points.md#public-imports).

Vite consumers can import the shared config from `@emulsify/core/vite` and public Vite plugin helpers from `@emulsify/core/vite/plugins`.

## Contributing

Maintained JavaScript source, config, scripts, and tests should use consistent comments:

- Start each maintained JS file with a short JSDoc file block that explains the file's responsibility.
- Use JSDoc blocks for exported functions, complex helpers, and public contracts.
- Use `//` comments for local intent, compatibility behavior, and non-obvious edge cases.
- Keep comments concise and factual. Prefer explaining why behavior exists instead of restating the code.
- Use YAML or shell comments in workflow, hook, and fixture files where the format supports comments.

Do not add comments to JSON files, lockfiles, binary assets, generated output, legal documents, or dependency files. Those formats either do not support comments or should remain exact artifacts.

Please also follow the issue template and pull request templates provided. See below for the correct places to post issues:

1. [Emulsify Drupal](https://github.com/emulsify-ds/emulsify-drupal/issues)
2. [Emulsify Tools (Drupal module)](https://www.drupal.org/project/issues/emulsify_tools)

## Links

- [Emulsify Homepage](https://www.emulsify.info/)
- [Storybook Demo](http://storybook.emulsify.info/)
- [Code of Conduct](https://github.com/emulsify-ds/emulsify-drupal/blob/master/CODE_OF_CONDUCT.md)

## Author

Emulsify&reg; is a product of [Four Kitchens](https://fourkitchens.com).
