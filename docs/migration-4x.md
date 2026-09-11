# Migration To 4.x

Emulsify Core 4 runs on Vite and React/Vite Storybook while preserving existing
component structures. This guide is for projects upgrading from pre-4.x,
Webpack-based versions. Projects already using Core 4 should instead review the
[release notes for 4.3.0](releases/4.3.0.md).

## Requirements

The Core 4 major-version contract began at Node.js 24 or later. Consumers
installing Core 4.3.0 must use Node.js 24.13.0 or later because of its published
toolchain dependencies. See the
[4.3.0 Node.js policy](releases/4.3.0.md#nodejs-support-policy) for the exact
compatibility impact.

## Upgrade Summary

| Area                    | What Changed                                                                                                                               | What Did Not Change                                                                                                                                   | What May Require Changes                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Build tool              | Vite replaces the Webpack build.                                                                                                           | Component JS, Sass/CSS, Twig, metadata, and static assets still build or copy into deterministic paths.                                               | Webpack-specific customizations should move to `config/emulsify-core/vite/plugins.*`.                                            |
| Storybook               | Storybook uses `@storybook/react-vite`.                                                                                                    | Twig stories and React stories can live in the same Storybook instance. Existing Twig stories that return HTML strings are wrapped for compatibility. | Imported Twig templates should render through `renderTwig()` from `@emulsify/core/storybook` when stories are actively migrated. |
| Runtime                 | The Core 4 public runtime contract begins at Node.js 24. Core 4.3.0 raises its consumer floor to Node.js 24.13.0.                          | Project scripts still run through npm and the shared Emulsify Core config.                                                                            | Check the installed release's `package.json#engines.node`; Core 4.3.0 consumers must use Node.js 24.13.0 or later.               |
| Project configuration   | `project.emulsify.json` is the source of truth for platform and structure configuration.                                                   | Existing `src/components`, root `./components`, and configured `variant.structureImplementations` remain.                                             | Projects missing `project.emulsify.json` should add one before relying on platform-specific behavior.                            |
| Platform behavior       | Platform adapters control platform-specific behavior. Implemented adapters are currently `none`, `wordpress`, and `drupal`.                | Drupal SDC mirroring remains supported for Drupal projects that opt into it.                                                                          | WordPress/Timber projects can use `wordpress`; other non-Drupal projects can use `none` unless they need a dedicated adapter.    |
| Extension configuration | Vite extension files live under `config/emulsify-core/vite/plugins.*`.                                                                     | Storybook overrides still live under `config/emulsify-core/storybook/...`; a11y config still lives at `config/emulsify-core/a11y.config.js`.          | Projects with old Webpack override files should replace them with Vite extensions.                                               |
| CSS asset URLs          | `/assets/...` and `@assets/...` are equivalent first-class aliases; legacy bare and wrong-depth URLs resolve to the correct emitted depth. | `dist/` remains self-contained by default, with referenced project assets under `dist/assets/`.                                                       | No consumer action is required; lean output is an explicit opt-in.                                                               |

## Known Limitations

Review the [Known Limitations](../README.md#known-limitations) before upgrading. The key points are that `none`, `wordpress`, and `drupal` adapters are implemented today, the WordPress adapter is intentionally neutral and does not emulate WordPress or Timber PHP runtime behavior, large Twig libraries should account for eager Storybook Twig imports, Webpack customizations need manual Vite migration, and Drupal SDC mirroring applies only when the Drupal adapter and SDC settings are enabled. Development watch builds retain readable JavaScript and direct-entry CSS with source maps, while production builds minify both and omit maps.

## What Changed

- Webpack has been replaced with Vite.
- Storybook uses `@storybook/react-vite`.
- Twig rendering remains supported through Emulsify's Twig integration.
- React components are supported directly through Storybook's React/Vite setup.
- Twig and React stories can coexist in the same Storybook instance.
- `project.emulsify.json` is the source of truth for platform and structure configuration.
- Platform-specific behavior is controlled by platform adapters instead of being assumed globally.
- Sass and CSS can use either `/assets/...` or `@assets/...` as a first-class
  project-asset alias. Legacy bare and wrong-depth forms are repaired when
  exactly one configured asset root matches.

## What Did Not Change

- Existing component roots do not need to move just to upgrade.
- Root `./components` remains a valid source structure.
- Drupal SDC output mirroring remains supported when the Drupal adapter and `project.singleDirectoryComponents` enable it.
- Twig component authoring remains supported.
- Component metadata and static component assets are still copied beside component output.
- Referenced project assets still keep `dist/` deployable as a self-contained
  unit by default.

## What May Require Changes

- Update consuming project development and CI environments to Node.js 24.13.0
  or later.
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

Use `--fail-on warn` to make errors and warnings enforce migration progress in
CI. The existing `--fail-on-found` option remains a compatibility alias for
`--fail-on any`. If you only want the Twig story migration report, run
`npx --no-install emulsify-audit-twig-stories`.

For CI dashboards or downstream tooling, see
[Project Audit](audit.md) for the versioned JSON report contract, exit behavior,
and `jq` examples.

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
  relevant migration docs to stderr after running without contaminating JSON
  stdout.
- Update `@emulsify/core` to a Core 4-compatible version.
- Keep the root-level npm `overrides` listed in
  [Install Warning Controls](#install-warning-controls).

```json
{
  "description": "Storybook and a Vite-based build workflow powered by Emulsify Core 4",
  "engines": {
    "node": ">=24.13.0"
  },
  "type": "module",
  "scripts": {
    "audit": "sh -c 'node_modules/@emulsify/core/scripts/audit.js \"$@\"; status=$?; printf \"\\nAudit docs: https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/audit.md\\n\" >&2; exit $status' --",
    "audit:twig-stories": "sh -c 'node_modules/@emulsify/core/scripts/audit-twig-stories.js \"$@\"; status=$?; printf \"\\nMigration docs: https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/storybook.md#legacy-twig-story-compatibility\\n\" >&2; exit $status' --",
    "build": "npm run ensure-dist && vite build --config node_modules/@emulsify/core/config/vite/vite.config.js",
    "develop": "npm run --silent ensure-dist && concurrently --raw --no-shell \"npm run --silent vite\" \"npm run --silent storybook\"",
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

Existing Core 4 themes whose copied audit wrappers print documentation footers
to stdout need one correction for JSON consumers. Keep the footer, redirect
its `printf` to stderr, and retain the saved audit exit status:

```sh
# Before: the footer follows the JSON on stdout.
...; status=$?; printf "\nAudit docs: ...\n"; exit $status
# After: stdout contains only the audit report.
...; status=$?; printf "\nAudit docs: ...\n" >&2; exit $status
```

Apply the same redirection to `audit:twig-stories` if it has a copied footer.
Keep `"$@"` in the wrapper so each argument is forwarded intact, and use npm's
silent invocation to suppress its own script echo:

```sh
npm run --silent audit -- --root "/path/to/my theme" --json --fail-on warn
npm run --silent audit:twig-stories -- --root "/path/to/my theme" --json --fail-on-found
```

The two audit commands use different failure flags. Preserve `status=$?`
immediately after the executable and `exit $status` after the footer, so a
successful `printf` cannot mask an audit failure. The direct alternatives are
`npx --no-install emulsify-audit --json` and
`npx --no-install emulsify-audit-twig-stories --json`.

No theme regeneration is required; updating Core cannot edit scripts already
copied into the theme's own `package.json`. New themes receive the wrappers
from the starter revision used to generate them. See the
[verified starter availability](releases/4.5.0.md#starter-availability) before
assuming a starter release contains the correction.

The `--silent` flags in `develop` are cosmetic. `concurrently` spawns each task
as its own `npm run`, and npm echoes the script it is about to execute, so a
plain `concurrently --raw --no-shell npm:vite npm:storybook` opens every develop
session with several lines of script echo before either tool has said anything.
Existing scripts without the flags keep working; they are just noisier.

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

See [Storybook](storybook.md) for current Twig behavior and the
[4.3.0 release notes](releases/4.3.0.md) for the dependency, cache, HMR, and
asset-source changes delivered in that release.

## Drupal Behavior

Drupal-specific Storybook behavior comes from the Drupal platform adapter. `none`, `wordpress`, and unknown platforms do not create or require a Drupal global by default.

For Drupal projects, Storybook initializes a browser compatibility shim with `window.Drupal`, `window.Drupal.behaviors`, `Drupal.t()`, `Drupal.formatString()`, and neutral `window.drupalSettings` defaults. Projects can still add module-specific `drupalSettings` values from `config/emulsify-core/storybook/preview.js`; Emulsify Core merges those values with the defaults when the shim loads.

Drupal SDC mirroring remains supported for Drupal projects that enable `singleDirectoryComponents`.

WordPress and Timber projects can set `project.platform` to `wordpress`. The WordPress adapter is intentionally neutral: it keeps output in `dist/`, uses normal `dist/**/*.css` Storybook CSS loading, supports Core Twig authoring, Storybook, Vite, `bem()`, `add_attributes()`, `include()`, and `source()`, and does not enable Drupal behavior, Drupal Twig filters, or SDC mirroring. It does not emulate WordPress or Timber PHP runtime behavior; runtime integration belongs in `emulsify-wordpress-theme`.

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

Sass glob expansion supports modern `@use` patterns such as
`@use "./components/**/*.scss";` and retains legacy globbed `@import` support
for existing themes. Prefer `@use` in new code. Migrating existing `@import`
globs requires reviewing Sass namespace and scoping changes rather than only
changing the at-rule.

## CSS Asset URLs

Use either `/assets/...` or `@assets/...` URLs for fonts, SVGs, background
images, and other static files under a project asset root. Both are first-class
aliases and produce the same emitted URL.

```scss
$font-url: '@assets/fonts/example';

@font-face {
  font-family: 'Example Sans';
  src: url('#{$font-url}/Example-Regular.woff2') format('woff2');
}

.icon {
  background-image: url('/assets/icons/arrow.svg');
}
```

Storybook serves project asset roots at `/assets`. During the Vite build,
Emulsify resolves both first-class spellings against those roots and writes the
same path relative to the emitted CSS file, so the same authored Sass works in
Storybook and in built platform CSS. Neither spelling is reported as a repair.

By default, referenced project assets are kept or emitted under `dist/assets/`,
and built CSS points at those copies. The output therefore remains deployable
as a self-contained unit. The first-class `/assets/...` and `@assets/...` forms
resolve directly, while legacy bare and wrong-depth URL forms gain the repair
described below. Projects that always deploy the complete theme can set
`assets.selfContainedOutput` to `false` for leaner output whose CSS reaches the
source asset roots instead. `assets.rebase: false` is the separate, end-to-end
escape hatch that disables `@assets/...` normalization, legacy repair, and
final relativization.

Avoid hard-coded platform or deployment paths in Sass. They may work in a single
runtime, but they bypass Storybook's static asset mount and make components
harder to reuse.

Vite also resolves ordinary relative `url(...)` values relative to the
stylesheet it is compiling. A relative URL whose depth suits the _emitted_ CSS
rather than the stylesheet — `url('../../assets/images/hero.jpg')` — does not
resolve, and Vite prints a message such as:

```text
../../../assets/fonts/Example-Regular.woff2 referenced in ../../../assets/fonts/Example-Regular.woff2 didn't resolve at build time, it will remain unchanged to be resolved at runtime
```

Such a URL is then re-anchored to wherever the CSS landed, and that location
differs per project shape — so a depth that works on mirrored Drupal SDC output
breaks under every other shape. Emulsify repairs these: when the URL names the
published `assets/` prefix and matches exactly one file under one asset root, it
is rewritten to `/assets/...` and the asset is emitted. Each repair is reported,
and `emulsify-audit --fix` writes `/assets/...` as its stable canonical output.
The equivalent authored `@assets/...` alias is valid and is not reported or
rewritten. See
[Asset References](asset-references.md#why-a-relative-path-is-not-portable) for
the depth table, output-mode control, and `assets.rebase` opt-out.

A URL the repair cannot place — a typo, or a filename that exists under two
asset roots — is still left unchanged and reported. Set
`EMULSIFY_STRICT_ASSETS=1` to make that fail the build in CI.

See [Asset References](asset-references.md) for Sass/CSS and Twig examples,
including inline SVGs through `source('@assets/...')`.

## Upgrade Checklist

1. Use Node.js 24.13.0 or later.
2. Keep existing component roots unless you are intentionally restructuring.
3. Add or verify `project.emulsify.json`, including the appropriate `none`, `wordpress`, or `drupal` platform setting.
4. Move Webpack-specific customization to Vite extension files.
5. Run `npx --no-install emulsify-audit` and update actively maintained Twig stories to use `renderTwig()`.
6. Keep Drupal SDC settings in `project.singleDirectoryComponents` when needed.
7. Add React stories directly where useful; no Twig refactor is required.

No migration step is required for CSS asset resolution: the default output
remains self-contained and the newly handled URL forms were unresolved in
4.3.2.
