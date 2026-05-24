![Emulsify Core Design System](https://github.com/emulsify-ds/.github/blob/6bd435be881bd820bddfa05d88905efe29176a0a/assets/images/header.png)

# Emulsify Core

An open-source toolset for creating and implementing design systems.

**Emulsify Core** provides shared [Vite](https://vite.dev/) build configuration and a [Storybook](https://storybook.js.org/) component library setup for component-driven development. In 4.x, Twig-based components and React components are both supported authoring models. A project can be Twig-first, React-first, or intentionally mixed. Emulsify Core's job is to provide the shared build, Storybook, and project-structure conventions around those choices.

## Overview: component authoring options

Twig and React are equally valid ways to build component libraries with Emulsify Core. The right authoring model depends on the consuming project:

- Use Twig for CMS themes and server-rendered template systems such as Drupal, Craft CMS, or WordPress + Timber.
- Use React for standalone UI libraries, application components, or projects that already use React.
- Use mixed Twig and React when a design system needs to document both CMS-rendered and JavaScript-rendered components in the same Storybook instance.

Storybook uses the React/Vite framework. Twig files are transformed into render functions and can be rendered through Emulsify's public Storybook helper. React components render through Storybook's React support.

## What changed in 4.x

- Webpack has been replaced with Vite.
- Storybook now uses `@storybook/react-vite`.
- Twig rendering remains supported through Emulsify's Twig integration.
- React components are supported directly through Storybook's React/Vite setup.
- Twig and React stories can coexist in the same Storybook instance.
- `project.emulsify.json` is the source of truth for platform and structure configuration.
- Platform-specific behavior is controlled by platform adapters instead of being assumed globally.
- Node.js 24 or later is required.

Current release-readiness coverage validates Drupal SDC projects using `src/components`, generic Twig projects using `src/components`, root `./components` projects, projects using multiple `variant.structureImplementations`, and a mixed Twig + React Storybook project. Craft CMS and WordPress + Timber are documented as Twig-based project use cases and future platform-adapter directions; the implemented adapters in this package are currently `generic` and `drupal`.

## Supported component authoring models

### Twig component libraries

Twig component libraries use `.twig` templates as the component implementation. This is a good fit for CMS themes and server-rendered systems where the production markup is rendered by Twig.

Twig imports are transformed into render functions that accept Storybook args as Twig context. Use `renderTwig()` from `@emulsify/core/storybook` to render imported Twig templates in React-based Storybook:

```js
import template from './button.twig';
import { renderTwig } from '@emulsify/core/storybook';

export default {
  title: 'Components/Button',
};

export const Default = {
  render: renderTwig(template),
  args: {
    text: 'Read more',
  },
};
```

Emulsify Core registers native Twig.js implementations for `bem()` and `add_attributes()`. Storybook also includes compatibility helpers for Twig `include()` and `source()` usage. Drupal-specific Twig filters are registered only when the active platform adapter enables Drupal behavior.

### React component libraries

React component libraries use React components as the implementation. This is a good fit for standalone UI packages, application components, and design systems consumed by React applications.

Storybook discovers React stories from the same normalized story roots as Twig stories. The shared Storybook globs include `*.stories.js`, `*.stories.jsx`, `*.stories.ts`, and `*.stories.tsx`; current release fixture coverage validates JavaScript/JSX stories.

```jsx
import { Button } from './Button';

export default {
  title: 'Components/Button',
  component: Button,
};

export const Default = {
  args: {
    text: 'Read more',
  },
};
```

### Mixed Twig and React Storybook libraries

Mixed libraries use Twig and React in the same Storybook instance. This is useful when a design system needs to document server-rendered CMS components beside JavaScript-rendered application components.

Twig and React stories can share the same title hierarchy, Storybook addons, Sass conventions, and project structure. They do not need to share implementation details.

## Simple Twig component example

`button.twig`:

```twig
{#
 * @file
 * Button component.
 *
 * Available variables:
 * - text: Button text.
 * - url: Optional URL. When present, renders an anchor.
 * - icon: Optional icon name.
 * - modifiers: Optional BEM modifiers.
 #}

{% set button_attributes = {
  class: bem('button', modifiers|default([])),
} %}

{% if url %}
  <a href="{{ url }}" {{ add_attributes(button_attributes) }}>
    <span class="button__text">{{ text }}</span>
    {% if icon %}
      <span class="button__icon" aria-hidden="true">
        {{ icon }}
      </span>
    {% endif %}
  </a>
{% else %}
  <button type="button" {{ add_attributes(button_attributes) }}>
    <span class="button__text">{{ text }}</span>
    {% if icon %}
      <span class="button__icon" aria-hidden="true">
        {{ icon }}
      </span>
    {% endif %}
  </button>
{% endif %}
```

`button.stories.js`:

```js
import template from './button.twig';
import { renderTwig } from '@emulsify/core/storybook';

export default {
  title: 'Components/Button',
  render: renderTwig(template),
  args: {
    text: 'Read more',
    url: '#',
    icon: '→',
    modifiers: ['primary'],
  },
};

export const Default = {};
```

Optional `button.scss`:

```scss
.button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
```

## Simple React component example

`Button.jsx`:

```jsx
import './button.scss';

export function Button({
  text = 'Read more',
  url,
  icon,
  modifiers = [],
  onClick,
}) {
  const classes = [
    'button',
    ...modifiers.map((modifier) => `button--${modifier}`),
  ].join(' ');

  const content = (
    <>
      <span className="button__text">{text}</span>
      {icon ? (
        <span className="button__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
    </>
  );

  if (url) {
    return (
      <a className={classes} href={url}>
        {content}
      </a>
    );
  }

  return (
    <button className={classes} type="button" onClick={onClick}>
      {content}
    </button>
  );
}
```

`button.stories.jsx`:

```jsx
import { Button } from './Button';

export default {
  title: 'Components/Button',
  component: Button,
  args: {
    text: 'Read more',
    url: '#',
    icon: '→',
    modifiers: ['primary'],
  },
};

export const Default = {};
```

## Shared Sass/CSS example

Twig and React components can share class naming conventions and styles, but they do not have to share implementation details.

```scss
.button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  text-decoration: none;
}

.button--primary {
  font-weight: 700;
}

.button__icon {
  line-height: 1;
}
```

Sass files in supported component roots are included in the Vite build. Files beginning with `_` are treated as partials and are excluded from direct build entry generation. Storybook-specific styles using `cl-*` or `sb-*` naming are routed to Storybook output paths.

## Supported project structures

Emulsify Core reads `project.emulsify.json` once and normalizes project structure for Vite, Storybook, Twig namespaces, and copy behavior.

### `src/components`

`src/components` is the recommended structure for new projects:

```text
src/
  components/
    button/
      button.twig
      button.stories.js
      button.scss
```

When `src/` exists, global styles and scripts can live elsewhere under `src/`, outside `src/components` and `src/util`.

### Root `./components`

Root `./components` remains valid for existing projects:

```text
components/
  button/
    button.twig
    button.stories.js
    button.scss
```

Projects using this structure do not need to create `src/` just to upgrade to 4.x. Generic builds emit into `dist/`; Drupal SDC mirroring happens only when the Drupal adapter enables it.

### `variant.structureImplementations`

`variant.structureImplementations` is explicit configuration in `project.emulsify.json`. When present, those directories are respected above fallback discovery:

```json
{
  "project": {
    "platform": "generic",
    "name": "example",
    "machineName": "example"
  },
  "variant": {
    "structureImplementations": [
      { "name": "components", "directory": "./src/components/" },
      { "name": "foundation", "directory": "./src/foundation/" },
      { "name": "layout", "directory": "./src/layout/" },
      { "name": "tokens", "directory": "./src/tokens/" }
    ]
  }
}
```

Each implementation name becomes a structure root and Twig namespace, so templates can reference names such as `@components`, `@foundation`, `@layout`, and `@tokens`. Configured paths that resolve outside the project root are ignored.

## Platform behavior

The active platform is resolved in this order:

1. `EMULSIFY_PLATFORM`
2. `project.platform`
3. `variant.platform`
4. `generic`

### `generic`

The generic adapter keeps output in `dist/`. It does not load Drupal behavior shims, does not call `Drupal.attachBehaviors()`, and does not register Drupal Twig filters by default.

Unknown platform names currently use generic adapter behavior while preserving the resolved platform string. This lets future integrations such as WordPress + Timber or Craft CMS add their own adapters without forcing Drupal behavior onto every project.

### `drupal`

The Drupal adapter owns Drupal-specific behavior:

- Storybook loads the Drupal behavior shim.
- Storybook calls `Drupal.attachBehaviors()` after story render and args updates.
- Drupal Twig filters are registered by default.
- Drupal SDC component output can mirror from `dist/components` to root `./components`.

Platform adapters should control platform-specific behavior. Drupal behavior attachment and Drupal SDC mirroring should not be assumed for generic, React-only, WordPress + Timber, Craft CMS, or other non-Drupal projects.

## Drupal SDC behavior

Drupal SDC compatibility is controlled by `project.singleDirectoryComponents` and the Drupal platform adapter.

```json
{
  "project": {
    "platform": "drupal",
    "name": "whisk",
    "machineName": "whisk",
    "singleDirectoryComponents": true
  }
}
```

When a Drupal project uses `src/components` and `singleDirectoryComponents` is `true`, component output is built through `dist/components` and mirrored back to root `./components` for Drupal SDC compatibility. The mirrored root files are the files Drupal consumes.

Generic, React-only, and non-Drupal projects do not mirror component output to root `./components` by default. Root `./components` can still be a source directory for older projects; that is separate from Drupal SDC mirroring.

## Mixed Twig and React Storybook usage

Twig and React stories are discovered from the same normalized story roots. They can be organized by the same Storybook title hierarchy:

```text
src/
  components/
    button/
      button.twig
      button.stories.js
      button.scss
    badge/
      Badge.jsx
      badge.stories.jsx
      badge.scss
```

Both stories appear in the same Storybook instance. Twig stories should use `renderTwig()` for imported Twig templates. React stories use standard Storybook React component or render-function patterns.

## Output path matrix

The Vite outDir is `dist/` unless a platform adapter performs additional work after build. The release fixture suite asserts the paths below.

| Project type                               | JS output                                                                                                                                                          | CSS output                                                                                                                                                              | Twig output                                                                                       | Component metadata                                    | Assets                                                                                                                  | Storybook styles                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `src/components` generic project           | `dist/components/<name>/js/<file>.js`; global JS under `dist/global/**/js/*.js`                                                                                    | `dist/components/<name>/css/<file>.css`; global CSS under `dist/global/**/css/*.css`                                                                                    | `dist/components/<name>/<file>.twig`                                                              | `dist/components/<name>/*.component.yml` when present | `dist/components/<name>/<asset>`                                                                                        | `dist/storybook/<source-path>/<cl-or-sb-file>.css`             |
| `src/components` Drupal SDC project        | Mirrored to `components/<name>/<file>.js`                                                                                                                          | Mirrored to `components/<name>/<file>.css`                                                                                                                              | Mirrored to `components/<name>/<file>.twig`                                                       | Mirrored to `components/<name>/*.component.yml`       | Mirrored to `components/<name>/<asset>`                                                                                 | `dist/storybook/<source-path>/<cl-or-sb-file>.css`             |
| Root `./components` project                | `dist/components/<name>/js/<file>.js`                                                                                                                              | `dist/components/<name>/css/<file>.css`                                                                                                                                 | `dist/components/<name>/<file>.twig`                                                              | `dist/components/<name>/*.component.yml` when present | `dist/components/<name>/<asset>`                                                                                        | `dist/storybook/<component-path>/<cl-or-sb-file>.css`          |
| `variant.structureImplementations` project | Component-root JS can emit as `dist/js/<name>/<file>.js`; non-`components` roots preserve project-relative paths such as `dist/js/src/foundation/colors/colors.js` | Component-root CSS can emit as `dist/css/<name>/<file>.css`; non-`components` roots preserve project-relative paths such as `dist/css/src/foundation/colors/colors.css` | Copied under each named root, such as `dist/components/**`, `dist/layout/**`, or `dist/tokens/**` | Copied under the named root when present              | Copied under the named root, such as `dist/components/button/button.asset.txt` or `dist/foundation/colors/palette.json` | `dist/storybook/<project-relative-path>/<cl-or-sb-file>.css`   |
| React-only Storybook project               | Storybook builds React stories directly; Vite entry output applies to discovered `.js` and `.scss` files in supported roots                                        | Same Sass routing as the matching project structure                                                                                                                     | Not emitted unless Twig files exist                                                               | Not emitted unless component metadata exists          | Copied when non-code assets exist in supported roots                                                                    | Same Storybook style routing as the matching project structure |

## Project extension points

### Vite plugins and config patches

Projects can extend the shared Vite config with `.config/emulsify-core/vite/plugins.mjs`, `.config/emulsify-core/vite/plugins.js`, or `.config/emulsify-core/vite/plugins.cjs`.

Supported shapes:

```js
export default [myVitePlugin()];
```

```js
export default ({ env }) => [myVitePlugin({ env })];
```

```js
export const extendConfig = (config, { env }) => ({
  define: {
    __PROJECT_NAME__: JSON.stringify(env.machineName),
  },
});
```

### Storybook preview overrides

Projects can provide `config/emulsify-core/storybook/preview.js` to override or extend Storybook preview parameters. Missing override files are ignored. Default a11y parameters remain in place unless explicitly overridden.

```js
export const parameters = {
  layout: 'centered',
  a11y: {
    config: {
      detailedReport: false,
    },
  },
};
```

Preview head and manager head HTML remain separate extension points through `config/emulsify-core/storybook/preview-head.html` and `config/emulsify-core/storybook/manager-head.html`.

### Platform adapters

The implemented adapters are `generic` and `drupal`. The adapter model exposes platform behavior for Vite and Storybook, including Drupal behavior attachment, Drupal Twig filter registration, output strategy, and SDC mirroring. Future platform adapters should add platform-specific behavior there instead of changing global defaults.

## Public imports

Emulsify Core 4.x exposes stable public package paths:

```js
import { renderTwig } from '@emulsify/core/storybook';
import { registerTwigExtensions } from '@emulsify/core/extensions/twig';
import { defineReactExtension } from '@emulsify/core/extensions/react';
```

Vite consumers can import the shared config from `@emulsify/core/vite` and public Vite plugin helpers from `@emulsify/core/vite/plugins`.

## Migration notes from 3.x to 4.x

- Use Node.js 24 or later.
- Replace Webpack-specific customizations with Vite configuration or `.config/emulsify-core/vite/plugins.*` extensions.
- Storybook now runs on React/Vite. Twig stories still work, but imported Twig templates should be rendered with `renderTwig()` from `@emulsify/core/storybook`.
- Existing `src/components` projects remain supported.
- Existing root `./components` projects remain supported and do not need to move into `src/components` just to upgrade.
- Projects with `variant.structureImplementations` should keep that configuration in `project.emulsify.json`; those roots are treated as intentional and are respected before fallback discovery.
- Drupal-specific Storybook behavior now comes from the Drupal platform adapter. Generic and unknown platforms do not create or require a Drupal global by default.
- Drupal SDC mirroring remains supported for Drupal projects that enable `singleDirectoryComponents`.
- React stories can be added alongside existing Twig components without changing the Twig components.
- Twig and React stories can share the same Storybook title hierarchy and Sass class conventions.

## Installation and usage

Installation and configuration are usually set up by a project starter or platform package. Emulsify Drupal is the current Drupal reference integration. Core 4.x also supports generic project behavior for non-Drupal component libraries.

### Manual installation

- `npm install @emulsify/core` within your repository or project theme.
- Add a `project.emulsify.json` file at the project root.
- Add project scripts that call the Emulsify Core Storybook and Vite config.
- Add optional project extensions under `config/emulsify-core/` or `.config/emulsify-core/` when needed.

### Common scripts

Node.js 24 or later is required for every project script. Run `node --version` before running project scripts if you are unsure which runtime is active.

**storybook**
Starts a Storybook development server.

**lint**
Lints maintained JavaScript and Sass files.

**storybook-build**
Builds a static Storybook output.

**build**
Runs the Vite build for compiled JS, CSS, copied Twig templates, component metadata, and static component assets.

## Native extensions

Emulsify Core includes native Twig.js implementations for the Emulsify `bem()` and `add_attributes()` helpers. These are registered through one shared extension registry so Storybook, Vite Twig rendering, and imported Twig component modules use the same behavior.

The extension source lives under `src/extensions/`:

- `src/extensions/twig/` contains Twig functions and registration helpers.
- `src/extensions/shared/` contains reusable HTML attribute and list utilities.
- `src/extensions/react/` contains React extension registry helpers.

`bem()` remains backward-compatible with the existing positional API:

```twig
<h1 {{ bem('title', ['small', 'red'], 'card', ['js-click']) }}></h1>
```

It also supports object syntax:

```twig
<h1 {{ bem({
  block: 'card',
  element: 'title',
  modifiers: ['small', 'red'],
  extra: ['js-click']
}) }}></h1>
```

`add_attributes()` can compose with `bem()` output:

```twig
{% set additional_attributes = {
  class: bem('title', ['small'], 'card'),
  disabled: true
} %}

<h1 {{ add_attributes(additional_attributes) }}></h1>
```

## Code comment conventions

Maintained JavaScript source, config, scripts, and tests should use a consistent comment style:

- Start each maintained JS file with a short JSDoc file block that explains the file's responsibility.
- Use JSDoc blocks for exported functions, complex helpers, and public contracts.
- Use `//` comments for local intent, compatibility behavior, and non-obvious edge cases.
- Keep comments concise and factual. Prefer explaining why behavior exists instead of restating the code.
- Use YAML or shell comments in workflow, hook, and fixture files where the format supports comments.

Do not add comments to JSON files, lockfiles, binary assets, generated output, legal documents, or dependency files. Those formats either do not support comments or should remain exact artifacts.

## Quick links

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
