# Migration To The Current Release

Emulsify Core now runs on Vite and React/Vite Storybook while preserving existing component structures. This guide is for projects upgrading from earlier Webpack-based versions.

## Requirements

Use Node.js 24 or later. All maintained scripts run `scripts/check-node-version.js` before doing work.

## What Changed From Earlier Versions

- Webpack has been replaced with Vite.
- Storybook uses `@storybook/react-vite`.
- Twig rendering remains supported through Emulsify's Twig integration.
- React components are supported directly through Storybook's React/Vite setup.
- Twig and React stories can coexist in the same Storybook instance.
- `project.emulsify.json` is the source of truth for platform and structure configuration.
- Platform-specific behavior is controlled by platform adapters instead of being assumed globally.

## Component Structure Compatibility

Existing projects should not need to move components just to upgrade.

Supported source structures include:

- `src/components`
- root `./components`
- configured `variant.structureImplementations`

Projects with `variant.structureImplementations` should keep that configuration in `project.emulsify.json`; those roots are treated as intentional and are respected before fallback discovery.

## Storybook Migration

Storybook runs on React/Vite. Twig stories still work, but imported Twig templates should be rendered with `renderTwig()` from `@emulsify/core/storybook`.

```js
import template from './button.twig';
import { renderTwig } from '@emulsify/core/storybook';

export default {
  title: 'Components/Button',
  render: renderTwig(template),
};

export const Default = {
  args: {
    text: 'Read more',
  },
};
```

React stories can be added alongside existing Twig components without changing the Twig components.

## Twig Runtime

Emulsify Core's Storybook Twig runtime supports:

- Native `bem()` and `add_attributes()` helpers.
- Native `switch`, `case`, `default`, and `endswitch` tags.
- Storybook `include()` and `source()` helpers backed by the normalized project structure model.
- Optional platform Twig extensions supplied by platform adapters.

Drupal-specific Twig filters are only loaded when the Drupal adapter enables them.

## Drupal Behavior

Drupal-specific Storybook behavior comes from the Drupal platform adapter. Generic and unknown platforms do not create or require a Drupal global by default.

Drupal SDC mirroring remains supported for Drupal projects that enable `singleDirectoryComponents`.

## Vite Customization

Replace Webpack-specific customizations with Vite configuration or `.config/emulsify-core/vite/plugins.*` extensions.

```js
// .config/emulsify-core/vite/plugins.mjs
export default ({ env }) => [
  myVitePlugin({
    projectName: env.machineName,
  }),
];
```

See [Extension Points](extension-points.md) for Vite plugins, Tailwind CSS, Storybook preview overrides, and framework integrations.

## Upgrade Checklist

1. Use Node.js 24 or later.
2. Keep existing component roots unless you are intentionally restructuring.
3. Add or verify `project.emulsify.json`.
4. Move Webpack-specific customization to Vite extension files.
5. Update Twig stories to use `renderTwig()` for imported Twig templates.
6. Keep Drupal SDC settings in `project.singleDirectoryComponents` when needed.
7. Add React stories directly where useful; no Twig refactor is required.
