# Migration To The Current Release

Emulsify Core now runs on Vite and React/Vite Storybook while preserving existing component structures. This guide is for projects upgrading from earlier Webpack-based versions.

## Requirements

Use Node.js 24 or later. All maintained scripts run `scripts/check-node-version.js` before doing work.

## Upgrade Summary

| Area                    | What Changed                                                                                                     | What Did Not Change                                                                                       | What May Require Changes                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Build tool              | Vite replaces the Webpack build.                                                                                 | Component JS, Sass/CSS, Twig, metadata, and static assets still build or copy into deterministic paths.   | Webpack-specific customizations should move to `.config/emulsify-core/vite/plugins.*`.                |
| Storybook               | Storybook uses `@storybook/react-vite`.                                                                          | Twig stories and React stories can live in the same Storybook instance.                                   | Imported Twig templates should render through `renderTwig()` from `@emulsify/core/storybook`.         |
| Runtime                 | Node.js 24 is the supported floor.                                                                               | Project scripts still run through npm and the shared Emulsify Core config.                                | Local developer machines and CI images must use Node.js 24 or later.                                  |
| Project configuration   | `project.emulsify.json` is the source of truth for platform and structure configuration.                         | Existing `src/components`, root `./components`, and configured `variant.structureImplementations` remain. | Projects missing `project.emulsify.json` should add one before relying on platform-specific behavior. |
| Platform behavior       | Platform adapters control platform-specific behavior. Implemented adapters are currently `generic` and `drupal`. | Drupal SDC mirroring remains supported for Drupal projects that opt into it.                              | Non-Drupal projects should use `generic` unless a dedicated adapter exists.                           |
| Extension configuration | Vite extension files live under `.config/emulsify-core/vite/plugins.*`.                                          | Storybook overrides still live under `config/emulsify-core/storybook/...`.                                | Projects with old Webpack override files should replace them with Vite extensions.                    |

## Known Limitations

Review the [Known Limitations](../README.md#known-limitations) before upgrading. The key points are that only `generic` and `drupal` adapters are implemented today, large Twig libraries should account for eager Storybook Twig imports, production sourcemaps are enabled unless overridden, Webpack customizations need manual Vite migration, and Drupal SDC mirroring applies only when the Drupal adapter and SDC settings are enabled.

## What Changed

- Webpack has been replaced with Vite.
- Storybook uses `@storybook/react-vite`.
- Twig rendering remains supported through Emulsify's Twig integration.
- React components are supported directly through Storybook's React/Vite setup.
- Twig and React stories can coexist in the same Storybook instance.
- `project.emulsify.json` is the source of truth for platform and structure configuration.
- Platform-specific behavior is controlled by platform adapters instead of being assumed globally.

## What Did Not Change

- Existing component roots do not need to move just to upgrade.
- Root `./components` remains a valid source structure.
- Drupal SDC output mirroring remains supported when the Drupal adapter and `project.singleDirectoryComponents` enable it.
- Twig component authoring remains supported.
- Component metadata and static component assets are still copied beside component output.

## What May Require Changes

- Update CI and local development to Node.js 24 or later.
- Move custom Webpack configuration to Vite plugins or `extendConfig()`.
- Update Twig stories that import `.twig` files to use `renderTwig()`.
- Review any project code that assumed Drupal behavior in Storybook. Drupal behavior now comes from the Drupal adapter.
- Review Storybook-only Twig file volume for very large libraries. See [Performance](performance.md) for the eager Twig import tradeoff.

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
