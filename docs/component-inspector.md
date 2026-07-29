# Component Inspector

`emulsify-inspect-components` reports the non-partial Twig templates recognized
by Emulsify Core, the references that can resolve each template, and the
directory where its built output is expected.

Run it from an installed project:

```sh
npx --no-install emulsify-inspect-components
```

Projects that use the command regularly can add a convenience script:

```json
{
  "scripts": {
    "inspect:components": "emulsify-inspect-components"
  }
}
```

Then run:

```sh
npm run inspect:components
```

The inspector uses the same normalized `project.emulsify.json`, source roots,
Twig namespaces, and output-path helpers as Core's Vite and Storybook tooling.
It therefore supports:

- `src/components`;
- root `./components`;
- named `variant.structureImplementations`;
- `none`, `wordpress`, and `drupal` platforms;
- Drupal SDC component mirroring when enabled;
- configured namespace roots such as `@components`, `@foundation`, `@layout`,
  and `@tokens`;
- project-scoped shorthand such as `project_id:button`.

Files whose names begin with `_` are treated as partials and omitted. The
report describes expected output paths; it does not require a build to exist
and does not modify the project.

## Filtering

Add one or more case-insensitive terms to filter the report:

```sh
npm run inspect:components -- card
npm run inspect:components -- card atoms
npx --no-install emulsify-inspect-components --filter card
```

Every term must match somewhere in the component name, source path, expected
output location, or template reference. Collision counts are calculated before
filtering, so an ambiguous shorthand remains marked even if the filter displays
only one of its matching templates.

## Selecting Another Project

From an Emulsify Core checkout or another directory, select a project root:

```sh
npm run inspect:components -- --root /path/to/project
```

## JSON Output

Use `--json` for scripts and other tools:

```sh
npx --no-install emulsify-inspect-components --json
```

The report contains project metadata and a `components` array:

```json
{
  "project": {
    "machineName": "example",
    "namespaceRoots": {
      "components": "./src/components"
    },
    "platform": "none",
    "singleDirectoryComponents": false
  },
  "components": [
    {
      "label": "Button",
      "name": "button",
      "namespaces": ["@components/button/button.twig", "example:button"],
      "namespaceCollisionCount": 1,
      "location": "./dist/components/button",
      "source": "./src/components/button"
    }
  ]
}
```

`namespaceCollisionCount` applies to project-scoped shorthand. When it is
greater than one, use an exact `@namespace/path.twig` reference to avoid
ambiguity.
