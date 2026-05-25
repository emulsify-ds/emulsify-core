# Platform Adapters

Platform adapters keep CMS-specific or framework-specific behavior out of the global defaults. Generic projects should not inherit Drupal behavior, and Drupal projects should keep SDC support when they opt into it.

## Platform Resolution

The active platform is resolved in this order:

1. `EMULSIFY_PLATFORM`
2. `project.platform`
3. `variant.platform`
4. `generic`

Unknown platform names currently use generic adapter behavior while preserving the resolved platform string. This lets future integrations such as WordPress + Timber or Craft CMS add their own adapters without forcing Drupal behavior onto every project.

## `generic`

The generic adapter keeps output in `dist/`. It does not load Drupal behavior shims, does not call `Drupal.attachBehaviors()`, and does not register Drupal Twig filters by default.

Use `generic` for standalone Twig libraries, React libraries, mixed Storybook libraries, or non-Drupal projects that do not need platform-specific output behavior.

```json
{
  "project": {
    "platform": "generic",
    "name": "example",
    "machineName": "example"
  }
}
```

## `drupal`

The Drupal adapter owns Drupal-specific behavior:

- Storybook loads the Drupal behavior shim.
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

Drupal behavior attachment and Drupal SDC mirroring should not be assumed for generic, React-only, WordPress + Timber, Craft CMS, or other non-Drupal projects.

## Drupal SDC Behavior

Drupal SDC compatibility is controlled by `project.singleDirectoryComponents` and the Drupal platform adapter.

When a Drupal project uses `src/components` and `singleDirectoryComponents` is `true`, component output is built through `dist/components` and mirrored back to root `./components` for Drupal SDC compatibility. The mirrored root files are the files Drupal consumes.

Generic, React-only, and non-Drupal projects do not mirror component output to root `./components` by default. Root `./components` can still be a source directory for older projects; that is separate from Drupal SDC mirroring.

## Future Platforms

Future adapters should own their platform-specific behavior instead of changing global defaults. Good adapter responsibilities include:

- Behavior attachment hooks.
- Optional Twig filters or functions.
- Output strategies.
- Static asset handling.
- CMS-specific mirroring or copy behavior.

WordPress + Timber and Craft CMS can use generic Twig behavior today. Dedicated adapters can be added later when those integrations need platform-specific defaults.
