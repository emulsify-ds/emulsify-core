![Emulsify Core Design System](https://github.com/emulsify-ds/.github/blob/6bd435be881bd820bddfa05d88905efe29176a0a/assets/images/header.png)

# Emulsify Core

An open-source foundation for building design systems across component
libraries, CMS themes, Storybook, and the handoff between design and
development.

**Emulsify Core** provides shared [Vite](https://vite.dev/) build configuration
and a [Storybook](https://storybook.js.org/) workspace for component-driven
development with Twig, React, and autonomous custom elements.

## How Emulsify Core Works

Emulsify Core is the shared frontend layer for Emulsify projects. It gives teams
one place to build, document, and test components while leaving platform-specific
implementation details where they belong.

- Vite builds project JavaScript, Sass/CSS, Twig templates, component metadata,
  and static component assets.
- Storybook runs on the React/Vite framework.
- Twig files render in React-based Storybook through `renderTwig()`.
- React components render through Storybook's standard React support.
- Autonomous custom elements render in Storybook through
  `renderWebComponent()`.
- Twig, React, and custom element stories can live together in one Storybook
  workspace.
- `project.emulsify.json` is the source of truth for platform and structure
  configuration.
- Platform adapters control CMS-specific behavior instead of assuming it
  globally.

## Node.js Runtime Policy

- Consumers are supported on Node.js 24.13.0 or later. The strictest published
  toolchain dependency, `stylelint-selector-bem-pattern` 5, requires that patch;
  Babel 8 also excludes Node.js 24.0 through 24.10.
- Contributors should use Node.js 24.13.0, the exact version pinned in `.nvmrc`.
- CI also uses Node.js 24.13.0 by reading `.nvmrc`, so local development and
  automated checks share the same recommended runtime.

## Project Evolution

Emulsify Core began as shared Webpack and Storybook tooling, adopted ESM in
3.x, and moved to Vite and React/Vite Storybook in 4.x. The current project
model supports CMS themes, standalone component libraries, and mixed Twig,
React, and custom element Storybook workspaces.

See [Version Evolution](docs/version-evolution.md) for major-version history
and the [4.3.0 release notes](docs/releases/4.3.0.md) for the compatibility
changes and additions in that release.

## Authoring Models

Emulsify Core supports Twig and React authoring workflows plus a focused
Storybook adapter for web components built with autonomous custom elements. The
right choice depends on how the design system will be used.

- Use Twig for CMS themes and server-rendered template systems. Drupal has a
  Drupal-specific adapter, and WordPress/Timber projects can use the
  intentionally neutral `wordpress` adapter. WordPress runtime integration
  belongs in `emulsify-wordpress-theme`.
- Use React for standalone UI libraries, application components, or projects
  that already use React.
- Use web components built with autonomous custom elements for
  framework-neutral browser components that fit the adapter's documented
  property, attribute, default-slot, and native event boundaries.
- Use mixed authoring when a design system needs to document CMS-rendered,
  framework-rendered, and framework-neutral components in the same Storybook
  instance.

See [Component Authoring](docs/component-authoring.md) for Twig, React, custom
element, mixed Storybook, and shared Sass examples.

## Installation And Project Setup

Emulsify Core can enter a project in two common ways. Both are supported and both
are valid. The right setup path depends on whether you are wiring Core into a
project yourself or starting from an Emulsify starter.

### Manual Setup With npm

Use npm when you want to add Emulsify Core to an existing project, a custom
starter, or a project that owns its own setup decisions.

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
  },
  "assets": {
    "roots": ["./design/assets"]
  }
}
```

Asset files are discovered from the default asset roots and any additional roots
configured in `project.emulsify.json`. Use asset roots when a project stores
fonts, images, icons, or other static files outside the default locations.

Common project scripts call the shared Emulsify Core Vite and Storybook config:

- `storybook`: starts Storybook development.
- `storybook-build`: builds static Storybook output.
- `build`: runs the Vite build for JS, CSS, copied Twig templates, component
  metadata, and static component assets.
- `lint`: lints maintained project source.

### Streamlined Setup With Emulsify CLI

Use the [Emulsify CLI](https://github.com/emulsify-ds/emulsify-cli) when you
want a starter-driven setup with project scaffolding, starter hooks, system
installation, and component generation.

Install the CLI globally:

```sh
npm install -g @emulsify/cli
```

Then initialize a project from a starter:

```sh
emulsify init "My Project" ./path/to/projects --platform none
```

The CLI supports built-in `drupal`, `wordpress`, and `none` platforms. It can
create starter projects, install component systems, list available components,
install system components, and generate local components. The starter owns the
project structure and scripts; Emulsify Core still provides the shared build and
Storybook foundation underneath.

## Documentation

The documentation is split by task:

| Topic                                                     | Use This When                                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [Version Evolution](docs/version-evolution.md)            | Understanding how Emulsify Core has evolved across major releases.                                                |
| [Component Authoring](docs/component-authoring.md)        | Choosing Twig, React, custom element, or mixed Storybook authoring and comparing component examples.              |
| [Storybook](docs/storybook.md)                            | Rendering Twig and custom element stories, using Storybook helpers, and mixing authoring models.                  |
| [Project Structure And Output](docs/project-structure.md) | Configuring `src/components`, root `./components`, `variant.structureImplementations`, and expected output paths. |
| [Platform Adapters](docs/platform-adapters.md)            | Understanding `none`, `wordpress`, `drupal`, platform resolution order, and Drupal SDC behavior.                  |
| [Extension Points](docs/extension-points.md)              | Adding Vite plugins, Tailwind CSS, Storybook preview overrides, and other framework tooling.                      |
| [Dependency Contract](docs/dependency-contract.md)        | Understanding why generated themes rely on Core runtime dependencies and npm hoisting.                            |
| [Performance](docs/performance.md)                        | Understanding sourcemaps, eager Twig imports, Tailwind scanning, copied files, and fixture validation.            |
| [Native Twig Extensions](docs/native-twig-extensions.md)  | Using `bem()`, `add_attributes()`, and `switch/case/default/endswitch` in Twig.js.                                |
| [Project Audit](docs/audit.md)                            | Running human or versioned JSON project audits and configuring CI failure thresholds.                             |
| [Release Verification](docs/release.md)                   | Running 4.x release checks, tarball smoke tests, and semantic-release dry runs before publishing.                 |
| [Migration To 4.x](docs/migration-4x.md)                  | Upgrading a pre-4.x/Webpack project while preserving existing structures.                                         |
| [4.3.0 Release Notes](docs/releases/4.3.0.md)             | Reviewing the 4.3.0 scope, compatibility changes, public APIs, limitations, and verification evidence.            |

## Known Limitations

Emulsify Core is intentionally focused on the shared build and Storybook layer.
Some integration work still belongs to the project, starter, theme, or platform
package using it.

- Implemented platform adapters are `none`, `wordpress`, and `drupal`. The
  `wordpress` adapter is intentionally neutral: it supports Core Twig authoring,
  Storybook, Vite, `bem()`, `add_attributes()`, `include()`, and `source()`, but
  it does not emulate WordPress or Timber PHP runtime behavior. Runtime
  integration belongs in `emulsify-wordpress-theme`. See
  [Platform Adapters](docs/platform-adapters.md).
- Storybook eagerly imports compiled Twig modules for synchronous rendering,
  while raw Twig and text asset sources load lazily when `source()` requests
  them. Large Twig libraries should still keep Storybook source roots
  intentional. See [Performance](docs/performance.md).
- Production sourcemaps are enabled by default unless a project overrides Vite
  config through `config/emulsify-core/vite/plugins.*`. See
  [Performance](docs/performance.md).
- Project extensions use the public `config/emulsify-core` directory:
  `config/emulsify-core/vite/plugins.*` for Vite,
  `config/emulsify-core/storybook/...` for Storybook, and
  `config/emulsify-core/a11y.config.js` for a11y. See
  [Extension Points](docs/extension-points.md).
- Webpack-specific customizations must be migrated manually to Vite plugins or
  `extendConfig()`. See [Migration](docs/migration-4x.md).
- Drupal SDC mirroring only applies when the Drupal adapter and SDC settings are
  enabled. `none` and `wordpress` projects should expect output to remain in
  `dist/`. See [Platform Adapters](docs/platform-adapters.md).
- Generated themes that depend only on `@emulsify/core` assume npm's flat
  `node_modules` hoisting for script binaries and shared config packages. pnpm's
  isolated linker and Yarn Plug'n'Play are unsupported for that one-dependency
  generated-theme pattern unless the consuming project declares each tool
  package itself. See [Dependency Contract](docs/dependency-contract.md).
- The Storybook renderer for custom elements supports autonomous custom elements,
  light DOM children for an unnamed default slot, and explicitly mapped native
  events. It does not provide a named-slot composition API or support
  customized built-in elements. See
  [Storybook](docs/storybook.md#known-limitations).

## Supported Project Shapes

Emulsify Core is designed to meet projects where they are. These project shapes
are supported:

- Drupal SDC projects using `src/components`.
- `none` platform Twig projects using `src/components`.
- `wordpress` platform Twig projects using `src/components`.
- Root `./components` projects.
- Projects using multiple `variant.structureImplementations`.
- Mixed Storybook projects with Twig, React, and custom elements.

WordPress and Timber projects should use `platform: "wordpress"` when they want
Core's neutral WordPress adapter. The adapter keeps output in `dist/`, loads
Storybook CSS from `dist/**/*.css`, and leaves WordPress runtime behavior to
`emulsify-wordpress-theme`.

## Public Imports

Emulsify Core exposes stable public package paths so consuming projects do not
need to reach into internal files:

```js
import { renderTwig } from '@emulsify/core/storybook';
import {
  defineCustomElement,
  renderWebComponent,
} from '@emulsify/core/storybook';
import { registerTwigExtensions } from '@emulsify/core/extensions/twig';
import { defineReactExtension } from '@emulsify/core/extensions/react';
```

`defineReactExtension` is reserved for future React extension support. It
currently returns the input unchanged. Adopting the import path is safe; the
runtime is intentionally a no-op until the registry lands. See
[Extension Points](docs/extension-points.md#public-imports).

Vite consumers can import the shared config from `@emulsify/core/vite`, public
Vite plugin helpers from `@emulsify/core/vite/plugins`, and platform adapter
helpers from `@emulsify/core/vite/platforms`.

`defineCustomElement()` and `renderWebComponent()` use the existing
`@emulsify/core/storybook` entry point; they do not require a dedicated package
subpath. The generated Twig asset-source runtime is internal and is not a
public package export.

## Contributing

Contributions should keep the codebase clear for the next person working in it.
Maintained JavaScript source, config, scripts, and tests should use consistent
comments:

- Start each maintained JS file with a short JSDoc file block that explains the file's responsibility.
- Use JSDoc blocks for exported functions, complex helpers, and public contracts.
- Use `//` comments for local intent, compatibility behavior, and non-obvious edge cases.
- Keep comments concise and factual. Prefer explaining why behavior exists instead of restating the code.
- Use YAML or shell comments in workflow, hook, and fixture files where the format supports comments.

Do not add comments to JSON files, lockfiles, binary assets, generated output,
legal documents, or dependency files. Those formats either do not support
comments or should remain exact artifacts.

Please also follow the issue template and pull request templates provided. See below for the correct places to post issues:

1. [Emulsify Drupal](https://github.com/emulsify-ds/emulsify-drupal/issues)
2. [Emulsify Tools (Drupal module)](https://www.drupal.org/project/issues/emulsify_tools)

## Links

- [Emulsify Homepage](https://www.emulsify.info/)
- [Storybook Demo](http://storybook.emulsify.info/)
- [Code of Conduct](https://github.com/emulsify-ds/emulsify-drupal/blob/master/CODE_OF_CONDUCT.md)

## Author

Emulsify&reg; is a product of [Four Kitchens](https://fourkitchens.com).
