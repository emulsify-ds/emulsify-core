# Platform Adapters

Platform adapters keep CMS-specific or framework-specific behavior out of the global defaults. Projects without platform-specific behavior should not inherit Drupal behavior, and Drupal projects should keep SDC support when they opt into it.

The implemented adapters are currently:

- `none`
- `wordpress`
- `drupal`

Emulsify Core supports Twig-based authoring for CMS-oriented projects. The `wordpress` adapter is intentionally neutral: it gives WordPress and Timber projects a first-class platform setting without adding PHP runtime shims or WordPress-specific rendering behavior to Core. WordPress runtime integration belongs in `emulsify-wordpress-theme`.

## Platform Resolution

The active platform is resolved in this order:

1. `EMULSIFY_PLATFORM`
2. `project.platform`
3. `variant.platform`
4. `none`

Unknown platform names currently use `none` adapter behavior while preserving the resolved platform string. This lets future integrations add their own adapters without forcing Drupal behavior onto every project.

CLI and theme tooling can import adapter helpers from `@emulsify/core/vite/platforms` instead of reaching into internal config paths.

## `none`

The `none` adapter keeps output in `dist/`. It does not load Drupal behavior shims, does not call `Drupal.attachBehaviors()`, and does not register Drupal Twig filters by default.

Use `none` for standalone Twig libraries, React libraries, mixed Storybook libraries, Craft CMS projects, or any project that does not need a named platform adapter. For CMS projects without a dedicated adapter, `none` means Emulsify Core provides Twig Storybook/runtime support and normal `dist/` output, but it does not add CMS-specific filters, behavior hooks, or mirroring.

```json
{
  "project": {
    "platform": "none",
    "name": "example",
    "machineName": "example"
  }
}
```

## `wordpress`

The WordPress adapter is a first-class, intentionally neutral adapter for WordPress and Timber projects that use Emulsify Core for component authoring and builds.

It provides these defaults:

- Vite output stays in `dist/`.
- Storybook loads compiled CSS from `dist/**/*.css`.
- Core Twig authoring, Storybook, Vite, `bem()`, `add_attributes()`, `include()`, and `source()` remain supported.
- Drupal behavior shims are not loaded.
- `Drupal.attachBehaviors()` is not called.
- Drupal Twig filters are not registered by default.
- Drupal SDC output is not mirrored to root `./components`.

The adapter does not emulate WordPress or Timber PHP runtime behavior. Core does not provide WordPress template loading, Timber context, PHP filters, or theme runtime shims. Those responsibilities belong in `emulsify-wordpress-theme`.

```json
{
  "project": {
    "platform": "wordpress",
    "name": "whisk",
    "machineName": "whisk"
  }
}
```

## `drupal`

The Drupal adapter owns Drupal-specific behavior:

- Storybook loads the Drupal behavior shim.
- The shim initializes `window.Drupal`, `window.Drupal.behaviors`, `Drupal.t()`, `Drupal.formatString()`, and neutral `window.drupalSettings` defaults for browser-authored JavaScript.
- Storybook calls `Drupal.attachBehaviors()` after story render and args updates.
- Drupal Twig filters are registered by default.
- Drupal SDC component output can mirror from `dist/components` to root `./components`.

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

Drupal behavior attachment and Drupal SDC mirroring should not be assumed for `none`, `wordpress`, React-only, Craft CMS, or other non-Drupal projects.

The Drupal settings shim intentionally includes only cross-project defaults. Projects that need module-specific browser settings can define them in `config/emulsify-core/storybook/preview.js` before stories render:

```js
window.drupalSettings = {
  ...(window.drupalSettings || {}),
  exampleModule: {
    enabled: true,
  },
};
```

Emulsify Core merges those project settings with its defaults when the Drupal adapter loads the shim, and project-provided values win.

## Drupal SDC Behavior

Drupal SDC compatibility is controlled by `project.singleDirectoryComponents` and the Drupal platform adapter.

When a Drupal project uses `src/components` and `singleDirectoryComponents` is `true`, component output is built through `dist/components` and mirrored back to root `./components` for Drupal SDC compatibility. The mirrored root files are the files Drupal consumes.

`none`, `wordpress`, React-only, and other non-Drupal projects do not mirror component output to root `./components` by default. Root `./components` can still be a source directory for older projects; that is separate from Drupal SDC mirroring.

## Future Platforms

Future adapters should own their platform-specific behavior instead of changing global defaults. Good adapter responsibilities include:

- Behavior attachment hooks.
- Optional Twig filters or functions.
- Output strategies.
- Static asset handling.
- CMS-specific mirroring or copy behavior.

Future adapters should be added only when an integration needs platform-specific defaults such as CMS filters, behavior hooks, asset handling, or output conventions. Runtime integrations should live in the owning platform package instead of adding broad runtime shims to Emulsify Core.
