# Migration To The Current Release

Emulsify Core now runs on Vite and React/Vite Storybook while preserving existing component structures. This guide is for projects upgrading from earlier Webpack-based versions.

## Requirements

Use Node.js 24 or later. All maintained scripts run `scripts/check-node-version.js` before doing work.

## Upgrade Summary

| Area                    | What Changed                                                                                                     | What Did Not Change                                                                                                                                   | What May Require Changes                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Build tool              | Vite replaces the Webpack build.                                                                                 | Component JS, Sass/CSS, Twig, metadata, and static assets still build or copy into deterministic paths.                                               | Webpack-specific customizations should move to `.config/emulsify-core/vite/plugins.*`.                                           |
| Storybook               | Storybook uses `@storybook/react-vite`.                                                                          | Twig stories and React stories can live in the same Storybook instance. Existing Twig stories that return HTML strings are wrapped for compatibility. | Imported Twig templates should render through `renderTwig()` from `@emulsify/core/storybook` when stories are actively migrated. |
| Runtime                 | Node.js 24 is the supported floor.                                                                               | Project scripts still run through npm and the shared Emulsify Core config.                                                                            | Local developer machines and CI images must use Node.js 24 or later.                                                             |
| Project configuration   | `project.emulsify.json` is the source of truth for platform and structure configuration.                         | Existing `src/components`, root `./components`, and configured `variant.structureImplementations` remain.                                             | Projects missing `project.emulsify.json` should add one before relying on platform-specific behavior.                            |
| Platform behavior       | Platform adapters control platform-specific behavior. Implemented adapters are currently `generic` and `drupal`. | Drupal SDC mirroring remains supported for Drupal projects that opt into it.                                                                          | Non-Drupal projects should use `generic` unless a dedicated adapter exists.                                                      |
| Extension configuration | Vite extension files live under `.config/emulsify-core/vite/plugins.*`.                                          | Storybook overrides still live under `config/emulsify-core/storybook/...`.                                                                            | Projects with old Webpack override files should replace them with Vite extensions.                                               |

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
- Existing Twig stories that return HTML strings can continue working during the upgrade. Use `npx --no-install emulsify-audit` to find stories that should move to `renderTwig()` and other upgrade-readiness items.
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

For older function stories that return `template(args)` directly, Emulsify Core wraps string results as HTML in the shared preview. That compatibility layer is intended to reduce upgrade churn; `renderTwig()` is still the clearer pattern for stories you are editing.

Run the audit script to list likely legacy Twig stories and other upgrade-readiness items:

```sh
npx --no-install emulsify-audit
```

The audit checks for Storybook files outside normalized source roots, unresolved
Twig `include()` or `source()` references, Webpack-era patterns, direct imports
of Emulsify Core internals, Drupal assumptions in non-Drupal projects, missing
configured structure roots, large Twig Storybook roots, and Twig stories that
should move to `renderTwig()`.

Use `--fail-on-found` if you want to make the audit enforce migration progress in CI. If you only want the Twig story migration report, run `npx --no-install emulsify-audit-twig-stories`.

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
5. Run `npx --no-install emulsify-audit` and update actively maintained Twig stories to use `renderTwig()`.
6. Keep Drupal SDC settings in `project.singleDirectoryComponents` when needed.
7. Add React stories directly where useful; no Twig refactor is required.
