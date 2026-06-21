# Platform Adapters

Platform adapters keep CMS-specific or framework-specific behavior out of the global defaults. Projects without platform-specific behavior should not inherit Drupal behavior, and Drupal projects should keep SDC support when they opt into it.

The implemented adapters are currently:

- `none`
- `drupal`

Emulsify Core supports Twig-based authoring for CMS-oriented projects, but WordPress and Timber do not have a dedicated adapter in this package yet. WordPress and Timber projects should currently use `platform: "none"`. This keeps Emulsify Core in platform-neutral mode while still supporting Twig-oriented component development. A dedicated WordPress adapter may be added later when WordPress-specific behavior is introduced.

## Platform Resolution

The active platform is resolved in this order:

1. `EMULSIFY_PLATFORM`
2. `project.platform`
3. `variant.platform`
4. `none`

Unknown platform names currently use `none` adapter behavior while preserving the resolved platform string. This lets future integrations add their own adapters without forcing Drupal behavior onto every project.

## `none`

The `none` adapter keeps output in `dist/`. It does not load Drupal behavior shims, does not call `Drupal.attachBehaviors()`, and does not register Drupal Twig filters by default.

Use `none` for standalone Twig libraries, React libraries, mixed Storybook libraries, WordPress and Timber projects, Craft CMS projects, or any non-Drupal project that does not need platform-specific output behavior. For CMS projects without a dedicated adapter, `none` means Emulsify Core provides Twig Storybook/runtime support and normal `dist/` output, but it does not add CMS-specific filters, behavior hooks, or mirroring.

```json
{
  "project": {
    "platform": "none",
    "name": "example",
    "machineName": "example"
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

Drupal behavior attachment and Drupal SDC mirroring should not be assumed for `none`, React-only, WordPress and Timber, Craft CMS, or other non-Drupal projects.

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

`none`, React-only, and non-Drupal projects do not mirror component output to root `./components` by default. Root `./components` can still be a source directory for older projects; that is separate from Drupal SDC mirroring.

## Future Platforms

Future adapters should own their platform-specific behavior instead of changing global defaults. Good adapter responsibilities include:

- Behavior attachment hooks.
- Optional Twig filters or functions.
- Output strategies.
- Static asset handling.
- CMS-specific mirroring or copy behavior.

WordPress and Timber projects should currently use `platform: "none"`. A dedicated WordPress adapter may be added later when WordPress-specific behavior is introduced. Future adapters should be added only when an integration needs platform-specific defaults such as CMS filters, behavior hooks, asset handling, or output conventions.
