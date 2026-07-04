# Native Twig Extensions

Emulsify Core includes native Twig.js implementations for the Emulsify `bem()` and `add_attributes()` helpers, plus `switch`, `case`, `default`, and `endswitch` logic tags compatible with Emulsify Tools 2.x templates. These are registered through one shared extension registry so Storybook, Vite Twig rendering, and imported Twig component modules use the same behavior.

The extension source lives under `src/extensions/`:

- `src/extensions/twig/` contains Twig functions, logic tags, and registration helpers.
- `src/extensions/shared/` contains reusable HTML attribute and list utilities.
- `src/extensions/react/` contains React extension registry helpers.

Storybook-only Twig runtime helpers live under `src/storybook/twig/`; see [Storybook](storybook.md#include) for `include()` and [Storybook](storybook.md#source) for `source()`.

## Storybook Runtime Helpers

Emulsify Core registers two additional Twig functions for Storybook-rendered Twig:

- `include()` renders another Twig template through the normalized project structure resolver. It supports namespace paths such as `@components/button/button.twig` and project-scoped component IDs such as `project_id:button`.
- `source()` returns raw Twig template source or project asset source for Storybook use cases such as code examples and inline SVG.

These helpers are Storybook runtime helpers, not native Twig extension exports from `@emulsify/core/extensions/twig`. Core's Storybook and Vite integrations register them automatically when Twig stories or imported Twig modules are rendered.

## Optional Drupal-Compatible Filters

Emulsify Core can register the
[`twig-drupal-filters`](https://github.com/kalamuna/twig-drupal-filters) package
for Storybook-rendered Twig. This is useful when templates use Drupal-style
filters or functions and the project still runs Storybook outside Drupal.

Drupal platform projects enable this automatically through the adapter. `none`
and `wordpress` projects can opt in with `project.emulsify.json`:

```json
{
  "project": {
    "platform": "wordpress"
  },
  "storybook": {
    "registerDrupalTwigFilters": true
  }
}
```

After restarting Storybook, filters such as `clean_class`, `clean_id`, and
`without` are available to Twig.js:

```twig
<div class="{{ title|clean_class }}">
  {{ attributes|without('id') }}
</div>
```

The package also provides stubs for Drupal-specific functions such as
`attach_library()`. Those stubs prevent Storybook compile errors, but they do
not attach real Drupal libraries or replace Drupal's server-side rendering.

See [Extension Points](extension-points.md#storybook-twigjs-extensions) for the
configuration details.

## `bem()`

`bem()` remains backward-compatible with the existing positional API:

```twig
<h1 {{ bem('title', ['small', 'red'], 'card', ['js-click']) }}></h1>
```

It also supports object syntax:

```twig
<h1 {{ bem({
  block: 'card',
  element: 'title',
  modifiers: ['small', 'red'],
  extra: ['js-click']
}) }}></h1>
```

The helper normalizes class values and supports arrays for modifiers and extra classes. It can be used directly in an attribute position or composed into `add_attributes()`.

## `add_attributes()`

`add_attributes()` renders HTML attributes from an object and can compose with `bem()` output:

```twig
{% set additional_attributes = {
  class: bem('title', ['small'], 'card'),
  disabled: true
} %}

<h1 {{ add_attributes(additional_attributes) }}></h1>
```

Boolean `true` attributes render without a value, Boolean `false` and nullish values are omitted, and class-like values are normalized for predictable output.

## `switch`, `case`, `default`, And `endswitch`

`switch` statements support PHP-style scalar matching and multiple values per `case` with `or`:

```twig
{% switch variant %}
  {% case 'primary' or 'secondary' %}
    <span class="badge badge--strong">{{ label }}</span>
  {% default %}
    <span class="badge">{{ label }}</span>
{% endswitch %}
```

The implementation is designed for Twig.js templates that need parity with Emulsify Tools 2.x switch templates. It validates that `case` and `default` are used inside `switch` and supports nested expressions in case values.

## Registering Extensions

Most projects do not need to call the registration APIs directly; Emulsify Core's Vite and Storybook integrations register them. Direct consumers can register Twig extensions explicitly:

```js
import Twig from 'twig';
import { registerTwigExtensions } from '@emulsify/core/extensions/twig';

registerTwigExtensions(Twig);
```

Registration is idempotent per Twig instance.
