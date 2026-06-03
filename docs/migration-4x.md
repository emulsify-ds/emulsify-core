# Migration To The Current Release

Emulsify Core now runs on Vite and React/Vite Storybook while preserving existing component structures. This guide is for projects upgrading from earlier Webpack-based versions.

## Requirements

Use Node.js 24 or later. All maintained scripts run `scripts/check-node-version.js` before doing work.

## Upgrade Summary

| Area                    | What Changed                                                                                                     | What Did Not Change                                                                                                                                   | What May Require Changes                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Build tool              | Vite replaces the Webpack build.                                                                                 | Component JS, Sass/CSS, Twig, metadata, and static assets still build or copy into deterministic paths.                                               | Webpack-specific customizations should move to `config/emulsify-core/vite/plugins.*`.                                            |
| Storybook               | Storybook uses `@storybook/react-vite`.                                                                          | Twig stories and React stories can live in the same Storybook instance. Existing Twig stories that return HTML strings are wrapped for compatibility. | Imported Twig templates should render through `renderTwig()` from `@emulsify/core/storybook` when stories are actively migrated. |
| Runtime                 | Node.js 24 is the supported floor.                                                                               | Project scripts still run through npm and the shared Emulsify Core config.                                                                            | Local developer machines and CI images must use Node.js 24 or later.                                                             |
| Project configuration   | `project.emulsify.json` is the source of truth for platform and structure configuration.                         | Existing `src/components`, root `./components`, and configured `variant.structureImplementations` remain.                                             | Projects missing `project.emulsify.json` should add one before relying on platform-specific behavior.                            |
| Platform behavior       | Platform adapters control platform-specific behavior. Implemented adapters are currently `generic` and `drupal`. | Drupal SDC mirroring remains supported for Drupal projects that opt into it.                                                                          | Non-Drupal projects should use `generic` unless a dedicated adapter exists.                                                      |
| Extension configuration | Vite extension files live under `config/emulsify-core/vite/plugins.*`.                                           | Storybook overrides still live under `config/emulsify-core/storybook/...`; a11y config still lives at `config/emulsify-core/a11y.config.js`.          | Projects with old Webpack override files should replace them with Vite extensions.                                               |

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

Storybook runs on React/Vite. Twig stories still work, but imported Twig templates should be rendered with `renderTwig()` from `@emulsify/core/storybook`. For new or edited Twig stories, prefer `render: renderTwig(template, { context })`.

```js
import buttonTwig from './button.twig';
import { renderTwig } from '@emulsify/core/storybook';

const context = (args) => ({
  text: args.text,
});

export default {
  title: 'Components/Button',
  render: renderTwig(buttonTwig, { context }),
};

export const Default = {
  args: {
    text: 'Read more',
  },
};
```

React stories can be added alongside existing Twig components without changing the Twig components.

For older function stories that return `template(args)` directly, Emulsify Core wraps string results as HTML in the shared preview. Legacy story elements that stringify to Twig HTML are also routed through the same `TwigHtmlStory` wrapper used by `renderTwig()`, so Storybook controls update through React instead of a DOM normalization step. That compatibility layer is intended to reduce upgrade churn.

`renderTwig(template, { context })` is still the preferred pattern for stories you are editing because it makes the Storybook-to-Twig boundary explicit. The imported Twig module renders Twig. The `context` function maps Storybook args to the Twig variable names your component expects. Storybook controls, HMR updates, lazy `source()` re-renders, and platform behavior attachment all run through the same React-managed wrapper.

Run the audit script to list likely legacy Twig stories and other upgrade-readiness items:

```sh
npx --no-install emulsify-audit
```

The audit scans normalized Emulsify source roots and checks for unresolved Twig
`include()` or `source()` references, CSS asset URLs that are missing or left to
runtime resolution, Webpack-era patterns, direct imports of Emulsify Core
internals, Drupal assumptions in non-Drupal projects, missing configured
structure roots, large Twig Storybook roots, and Twig stories that should move
to `renderTwig()`.

Use `--fail-on-found` if you want to make the audit enforce migration progress in CI. If you only want the Twig story migration report, run `npx --no-install emulsify-audit-twig-stories`.

## Manual package.json Updates

Generated themes copy their root `package.json` from the starter theme when the
theme is created. Updates to Whisk only affect future generated themes, so
existing projects must update their own `package.json` manually during the Core
4 migration.

Use the current Whisk package manifest as the reference for generated Drupal
themes. At minimum:

- Replace Webpack build scripts with Vite scripts.
- Remove `build-dev` and `webpack` scripts.
- Add `audit` and `audit:twig-stories` wrappers so project audits can print the
  relevant migration docs after running.
- Update `@emulsify/core` to a Core 4-compatible version.
- Keep the root-level npm `overrides` listed in
  [Install Warning Controls](#install-warning-controls).

```json
{
  "description": "Storybook and a Vite-based build workflow powered by Emulsify Core 4",
  "engines": {
    "node": ">=24"
  },
  "type": "module",
  "scripts": {
    "audit": "sh -c 'node_modules/@emulsify/core/scripts/audit.js \"$@\"; status=$?; printf \"\\nAudit docs: https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/migration-4x.md#storybook-migration\\n\"; exit $status' --",
    "audit:twig-stories": "sh -c 'node_modules/@emulsify/core/scripts/audit-twig-stories.js \"$@\"; status=$?; printf \"\\nMigration docs: https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/storybook.md#legacy-twig-story-compatibility\\n\"; exit $status' --",
    "build": "npm run ensure-dist && vite build --config node_modules/@emulsify/core/config/vite/vite.config.js",
    "develop": "npm run ensure-dist && concurrently --raw --no-shell npm:vite npm:storybook",
    "vite": "vite build --watch --config node_modules/@emulsify/core/config/vite/vite.config.js"
  },
  "dependencies": {
    "@emulsify/core": "^4.0.0"
  }
}
```

Projects with custom lint, Prettier, test, or Storybook scripts should keep
their project-specific behavior, but should still move Core build commands away
from `config/webpack` and into `config/vite`.

## Install Warning Controls

npm applies `overrides` only from the root package being installed. Overrides
inside `@emulsify/core` help this repository, but they do not automatically
apply when Core is installed as a dependency in a generated Drupal theme.

Generated or consuming themes should include these root-level overrides to pick
up compatible transitive dependency patches used by Core's tooling:

```json
{
  "overrides": {
    "glob": "^13.0.6",
    "locutus": "^3.0.36",
    "minimatch@3.0.x": "^3.1.5"
  }
}
```

These overrides are intentionally narrow. They do not replace the older Twig
integration packages; they only pin compatible transitive packages that reduce
known install warnings and audit noise while the Twig integration remains on the
current feature set.

## Twig Runtime

Emulsify Core's Storybook Twig runtime supports:

- Native `bem()` and `add_attributes()` helpers.
- Native `switch`, `case`, `default`, and `endswitch` tags.
- Storybook `include()` and `source()` helpers backed by the normalized project structure model.
- Optional platform Twig extensions supplied by platform adapters.

Drupal-specific Twig filters are only loaded when the Drupal adapter enables them.

Core 4 no longer uses a browser-global Twig template store or patches `Twig.Templates` to resolve compiled Storybook dependencies. Each emitted Twig module now creates an isolated Twig.js factory instance and registers its own compiled dependency set locally. This keeps duplicate template IDs from colliding while avoiding global runtime cleanup during HMR.

## Vituum Twig Integration

Emulsify treats `@vituum/vite-plugin-twig` as a pinned integration point. The internal `vituum-patch.js` adapter removes Vituum build hooks that conflict with Emulsify's output model and fails fast if a future Vituum release changes the expected plugin shape, so projects should pin to a known-good Vituum version or update the adapter instead of accepting a silent rendering break.

## Drupal Behavior

Drupal-specific Storybook behavior comes from the Drupal platform adapter. Generic and unknown platforms do not create or require a Drupal global by default.

For Drupal projects, Storybook initializes a browser compatibility shim with `window.Drupal`, `window.Drupal.behaviors`, `Drupal.t()`, `Drupal.formatString()`, and neutral `window.drupalSettings` defaults. Projects can still add module-specific `drupalSettings` values from `config/emulsify-core/storybook/preview.js`; Emulsify Core merges those values with the defaults when the shim loads.

Drupal SDC mirroring remains supported for Drupal projects that enable `singleDirectoryComponents`.

## Vite Customization

Replace Webpack-specific customizations with Vite configuration or `config/emulsify-core/vite/plugins.*` extensions.

```js
// config/emulsify-core/vite/plugins.mjs
export default ({ env }) => [
  myVitePlugin({
    projectName: env.machineName,
  }),
];
```

See [Extension Points](extension-points.md) for Vite plugins, Tailwind CSS, Storybook preview overrides, and framework integrations.

## CSS Asset URLs

Use project-root `/assets/...` URLs for fonts, SVGs, background images, and
other static files that live in root `assets/`.

```scss
$font-url: '/assets/fonts/example';

@font-face {
  font-family: 'Example Sans';
  src: url('#{$font-url}/Example-Regular.woff2') format('woff2');
}

.icon {
  background-image: url('/assets/icons/arrow.svg');
}
```

Storybook serves root `./assets` at `/assets`. During the Vite build, Emulsify
rewrites CSS `url('/assets/...')` and `url('assets/...')` references to paths
relative to the emitted CSS file, so the same authored Sass can work in
Storybook and built platform CSS.

Avoid hard-coded platform or deployment paths in Sass. They may work in a single
runtime, but they bypass Storybook's static asset mount and make components
harder to reuse.

Vite also resolves ordinary relative `url(...)` values relative to the
stylesheet it is compiling. When a stylesheet points outside the normalized
Emulsify source roots, Vite may leave the URL unchanged and print a message such
as:

```text
../../../assets/fonts/Example-Regular.woff2 referenced in ../../../assets/fonts/Example-Regular.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime
```

That can be intentional when the URL points at an asset the runtime serves
directly. Verify that the unchanged URL is valid from the compiled CSS file in
`dist/` or mirrored `components/` output.

To make Vite resolve and rebase the asset at build time, keep the asset under a
normalized source root and reference it relative to the authored stylesheet, or
keep it under project root `assets/` and use `/assets/...`.

See [Asset References](asset-references.md) for Sass/CSS and Twig examples,
including inline SVGs through `source('@assets/...')`.

## Upgrade Checklist

1. Use Node.js 24 or later.
2. Keep existing component roots unless you are intentionally restructuring.
3. Add or verify `project.emulsify.json`.
4. Move Webpack-specific customization to Vite extension files.
5. Run `npx --no-install emulsify-audit` and update actively maintained Twig stories to use `renderTwig()`.
6. Keep Drupal SDC settings in `project.singleDirectoryComponents` when needed.
7. Add React stories directly where useful; no Twig refactor is required.
