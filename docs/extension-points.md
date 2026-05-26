# Extension Points

Emulsify Core provides shared Vite and Storybook conventions. Project-specific framework tooling should live in the consuming project and connect through documented extension points.

## Directory Conventions

Project-level extension locations live under `config/emulsify-core`:

| Extension Type              | Directory                                          | Why                                                                                |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Vite plugins/config patches | `config/emulsify-core/vite/plugins.(mjs\|js\|cjs)` | Build-time Vite extensions are loaded only by Node/Vite.                           |
| Storybook overrides         | `config/emulsify-core/storybook/...`               | Storybook preview/head overrides are project-facing assets that Storybook imports. |
| A11y config                 | `config/emulsify-core/a11y.config.js`              | The a11y script keeps the existing project config path for compatibility.          |

Vite extensions should use `config/emulsify-core/vite/`. Storybook overrides should continue using `config/emulsify-core/storybook/`, and the a11y script continues to read `config/emulsify-core/a11y.config.js`.

## Vite Plugins And Config Patches

Projects can extend the shared Vite config with one of these files:

- `config/emulsify-core/vite/plugins.mjs`
- `config/emulsify-core/vite/plugins.js`
- `config/emulsify-core/vite/plugins.cjs`

Supported plugin shapes:

```js
export default [myVitePlugin()];
```

```js
export default ({ env }) => [myVitePlugin({ env })];
```

Projects can also export `extendConfig()` when they need to patch Vite config beyond adding plugins:

```js
export const extendConfig = (config, { env }) => ({
  define: {
    __PROJECT_NAME__: JSON.stringify(env.machineName),
  },
});
```

Use plugin arrays for normal framework integration. Use `extendConfig()` only when a plugin does not expose the needed config directly.

## Tailwind CSS

For Tailwind CSS v4, install Tailwind in the project:

```sh
npm install tailwindcss @tailwindcss/vite
```

Add the Tailwind Vite plugin from the project extension file:

```js
// config/emulsify-core/vite/plugins.mjs
import tailwindcss from '@tailwindcss/vite';

export default () => [tailwindcss()];
```

Create a CSS file that imports Tailwind. This example places it under `src/global`, but the file can live anywhere that makes sense for the project:

```css
/* src/global/tailwind.css */
@import 'tailwindcss';

/* Choose the source roots your project uses. */
@source "../components";
@source "../../components";
@source "../foundation";
@source "../layout";
@source "../tokens";
```

The `@source` lines are optional when Tailwind's automatic detection already sees the right files, but they make multi-root Emulsify projects explicit. Use `../components` for `src/components`, `../../components` for root `./components`, and add one line for each `variant.structureImplementations` root that should be scanned. Keep `@source` paths focused on active component source directories so Tailwind does not scan generated output, archived templates, or dependency folders.

For production builds, import the Tailwind CSS file from a discovered JavaScript entry:

```js
// src/global/tailwind.js
import './tailwind.css';
```

For Storybook development, import the same CSS file from the project preview override so Twig and React stories see the same utility classes:

```js
// config/emulsify-core/storybook/preview.js
import '../../../src/global/tailwind.css';

export const parameters = {};
```

Tailwind detects complete class names in Twig, React, and other templates. Avoid constructing utility class fragments dynamically, such as `text-${color}-600`; map variants to complete class strings instead.

## Other Vite Frameworks

Other Vite-based framework integrations follow the same pattern:

1. Install the framework package in the consuming project.
2. Return its Vite plugin from `config/emulsify-core/vite/plugins.*`.
3. Import any required framework CSS or setup files from a discovered project entry or Storybook preview override.
4. Use `extendConfig()` only when the framework needs additional Vite config.

Emulsify Core should not carry optional framework dependencies for every consuming project. Keep those dependencies local to the project that uses them.

## Storybook Main Overrides And Addons

Projects can provide `config/emulsify-core/storybook/main.js` to extend the shared Storybook main configuration. Use this for Storybook features that belong in Node-side config, such as addons, additional static directories, or final config shaping.

Project addons are appended to the Emulsify Core defaults, so a project can add one addon without repeating `@storybook/addon-a11y`, `@storybook/addon-links`, or `@storybook/addon-themes`.

```sh
npm install @storybook/addon-viewport
```

```js
// config/emulsify-core/storybook/main.js
export default {
  addons: ['@storybook/addon-viewport'],
};
```

Addon objects are also supported. If a project provides the same addon package name as a default addon, the project entry replaces the default entry so options can be customized without creating duplicates.

```js
// config/emulsify-core/storybook/main.js
export default {
  addons: [
    {
      name: '@storybook/addon-a11y',
      options: {
        manual: true,
      },
    },
  ],
};
```

When a project intentionally wants to replace the full addon list, export `replaceAddons`.

```js
// config/emulsify-core/storybook/main.js
export const replaceAddons = true;

export default {
  addons: ['@storybook/addon-viewport'],
};
```

For advanced cases, export `extendConfig()`. It receives the already-merged Storybook config and the resolved Emulsify environment.

```js
// config/emulsify-core/storybook/main.js
export function extendConfig(config, { env }) {
  const staticDirs = [...(config.staticDirs || [])];
  if (env.platform === 'generic') {
    staticDirs.push('public');
  }

  return {
    ...config,
    staticDirs,
  };
}
```

## Storybook Preview Overrides

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

Preview overrides are loaded in the browser-bundled Storybook preview through Vite-safe imports. They should not rely on CommonJS `require()`.

## Preview And Manager Head HTML

Preview head and manager head HTML remain separate extension points through:

- `config/emulsify-core/storybook/preview-head.html`
- `config/emulsify-core/storybook/manager-head.html`

Use preview head for markup needed inside the story iframe, such as fonts, meta tags, or scripts that rendered components depend on. Use manager head for Storybook chrome only.

## Public Imports

Emulsify Core exposes stable public package paths:

```js
import { renderTwig } from '@emulsify/core/storybook';
import { registerTwigExtensions } from '@emulsify/core/extensions/twig';
import { defineReactExtension } from '@emulsify/core/extensions/react';
```

Vite consumers can import the shared config from `@emulsify/core/vite` and public Vite plugin helpers from `@emulsify/core/vite/plugins`.
