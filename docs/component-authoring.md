# Component Authoring

Emulsify Core supports component-driven development with Vite and Storybook.
Twig and React have complete authoring workflows. Autonomous custom elements
have a focused Storybook adapter for property or attribute args, default-slot
content, and explicitly mapped native events. A project can use any one of
these approaches or intentionally mix them.

## Choosing An Authoring Model

Twig is a good fit for CMS themes and server-rendered template systems where production markup is rendered by Twig. Drupal has a Drupal-specific adapter, WordPress + Timber projects can use the neutral `wordpress` adapter, and Craft CMS or other Twig-based CMS projects can use `none` unless they need project-specific integration code.

React is a good fit for standalone UI packages, application components, and design systems consumed by React applications.

Autonomous custom elements are a good fit for framework-neutral JavaScript
components, design systems consumed by multiple applications, and small
interactive elements that should not require React at runtime.

Mixed libraries use Twig, React, and custom-element stories in the same
Storybook instance. This works well when a design system needs to document
CMS-rendered components, framework-rendered components, and framework-neutral
browser components together.

## Twig Component Libraries

Twig imports are transformed into render functions that accept Storybook args as Twig context. Use `renderTwig()` from `@emulsify/core/storybook` to render imported Twig templates in React-based Storybook.

```js
import buttonTwig from './button.twig';
import { renderTwig } from '@emulsify/core/storybook';

const context = (args) => ({
  text: args.text,
  url: args.url,
});

export default {
  title: 'Components/Button',
  render: renderTwig(buttonTwig, { context }),
  args: {
    text: 'Read more',
    url: '#',
  },
};

export const Default = {};
```

The recommended Twig story shape is `render: renderTwig(template, { context })`. The `context` function keeps the Storybook control names and the Twig variable names connected in one predictable place. Emulsify can then render the Twig output through React, which keeps controls, HMR, lazy `source()` re-renders, and platform behavior attachment working consistently.

Storybook's Twig runtime supports Emulsify's native Twig helpers plus `include()` and `source()` through the normalized project structure model. Drupal-specific Twig filters are registered only when the active platform adapter enables Drupal behavior. The WordPress adapter keeps these Core Twig authoring features available without emulating WordPress or Timber PHP runtime behavior.

## Component Metadata Imports

Component metadata files such as `*.component.yml` can be imported from stories
and Vite-side modules. YAML imports provide a default export with the full
parsed metadata object. Top-level keys that are valid JavaScript export names
are also available as named exports:

```js
import metadata, { props } from './accordion.component.yml';
```

Keys that are not safe JavaScript export names, such as `$schema` or
`display-name`, are not emitted as named exports. They remain available from the
default metadata object.

## React Component Libraries

React components render through Storybook's React/Vite support. Storybook discovers React stories from the same normalized story roots as Twig stories. The shared Storybook globs include `*.stories.js`, `*.stories.jsx`, `*.stories.ts`, and `*.stories.tsx`; fixture coverage validates JavaScript/JSX stories.

Production Vite builds also discover eligible `.jsx` files in supported source roots. They follow the same entry rules as `.js` files: stories, component metadata helpers, minified files, and test files are excluded, and the emitted browser bundle uses a `.js` filename. TypeScript entries and `.js` files containing JSX are outside this production entry support.

```jsx
import { Button } from './Button';

export default {
  title: 'Components/Button',
  component: Button,
};

export const Default = {
  args: {
    text: 'Read more',
  },
};
```

## Custom Element Stories

Autonomous custom elements render through the same React/Vite Storybook
framework using `renderWebComponent()` from `@emulsify/core/storybook`. The
helper returns a normal Storybook render function, creates the custom element,
and synchronizes Storybook args through its DOM API.

Register the browser custom element with `defineCustomElement()`. Repeated
evaluation with the same constructor is a no-op. If HMR supplies a different
constructor for an existing tag, the helper warns and returns the
browser-registered constructor; refresh Storybook to load the new class.

```js
import {
  defineCustomElement,
  renderWebComponent,
} from '@emulsify/core/storybook';
import { fn } from 'storybook/test';
import { GreetingCardElement } from './greeting-card.js';

defineCustomElement('greeting-card', GreetingCardElement);

export default {
  title: 'Components/Greeting Card',
  render: renderWebComponent('greeting-card', {
    events: {
      'greeting-select': 'onGreetingSelect',
    },
  }),
  args: {
    heading: 'Hello',
    body: 'Rendered as a vanilla custom element.',
    children: 'Content for the default slot',
    onGreetingSelect: fn(),
  },
};

export const Default = {};
```

By default, `renderWebComponent()` applies args as DOM properties:

```js
render: renderWebComponent('greeting-card', {
  argsAs: 'properties',
});
```

Property mode preserves object, array, and function references, which is
usually the right choice for custom elements with JavaScript APIs. When a
control update omits a property that was previously present, the renderer
assigns `undefined` so custom setters can clear stale state. Attribute mode is
available when a component is designed around attributes:

```js
render: renderWebComponent('greeting-card', {
  argsAs: 'attributes',
});
```

Attribute mode stringifies non-boolean values, writes `true` booleans as empty
attributes, and removes attributes for `false`, `null`, `undefined`, or a key
omitted by a later args object.

`args.children` is rendered as light DOM for a component's unnamed default
slot. The `events` option maps a native event name to a Storybook callback arg;
the callback receives the original `Event` or `CustomEvent`, including
`event.detail`. Mapped callback args are not assigned as element properties or
attributes.

`defineCustomElement()` validates the browser's custom-element naming rules,
reserved names, and that the constructor inherits from `HTMLElement` before it
uses the native registry.

Renderer `id` and `className` options apply to the custom element when there is
no wrapper. When `wrapper` is set, those options apply to the wrapper instead.
Storybook args always apply to the custom element and win while present.
Renderer options are never forwarded as element args.

The initial adapter intentionally supports autonomous custom elements and an
unnamed default slot. `defineCustomElement()` rejects customized built-in
constructors and registration options, and the renderer does not provide
named-slot composition. Native events must be listed in `events`; the renderer
does not infer React synthetic `on*` handlers. See
[Storybook Known Limitations](storybook.md#known-limitations) for the complete
boundary.

## Mixed Twig, React, And Custom Element Storybook Libraries

Twig, React, and custom-element stories can share the same title hierarchy,
Storybook addons, Sass conventions, and project structure. They do not need to
share implementation details.

```text
src/
  components/
    button/
      button.twig
      button.stories.js
      button.scss
    badge/
      Badge.jsx
      mount.jsx
      badge.stories.jsx
      badge.scss
    greeting-card/
      greeting-card.js
      greeting-card.stories.js
```

All stories appear in the same Storybook instance. Twig stories should use
`renderTwig(template, { context })` for imported Twig templates when authored
or actively migrated. Older Twig stories that return HTML strings directly
remain compatible through the shared Storybook preview, but the `renderTwig()`
shape is easier to maintain because it makes the Twig context mapping explicit.
React stories use standard Storybook React component or render-function
patterns. Custom-element stories use `defineCustomElement()` and
`renderWebComponent()`. A colocated `.jsx` mount file can be used as the
production Vite entry when a CMS needs a browser bundle for that React
component.

## WordPress And Timber Themes

WordPress and Timber projects should use `platform: "wordpress"` when they want Core's first-class WordPress adapter:

```json
{
  "project": {
    "platform": "wordpress",
    "name": "whisk",
    "machineName": "whisk"
  }
}
```

The adapter is intentionally neutral. It keeps Vite output in `dist/`, uses normal `dist/**/*.css` Storybook CSS loading, supports Core Twig authoring, Storybook, Vite, `bem()`, `add_attributes()`, `include()`, and `source()`, and does not enable Drupal behavior, Drupal Twig filters, or SDC mirroring.

Core does not provide WordPress template loading, Timber context, PHP filters, or theme runtime shims. WordPress runtime integration belongs in `emulsify-wordpress-theme`.

## Twig Button Example

`button.twig`:

```twig
{#
 * @file
 * Button component.
 *
 * Available variables:
 * - text: Button text.
 * - url: Optional URL. When present, renders an anchor.
 * - icon: Optional icon name.
 * - modifiers: Optional BEM modifiers.
 #}

{% set button_attributes = {
  class: bem('button', modifiers|default([])),
} %}

{% if url %}
  <a href="{{ url }}" {{ add_attributes(button_attributes) }}>
    <span class="button__text">{{ text }}</span>
    {% if icon %}
      <span class="button__icon" aria-hidden="true">
        {{ icon }}
      </span>
    {% endif %}
  </a>
{% else %}
  <button type="button" {{ add_attributes(button_attributes) }}>
    <span class="button__text">{{ text }}</span>
    {% if icon %}
      <span class="button__icon" aria-hidden="true">
        {{ icon }}
      </span>
    {% endif %}
  </button>
{% endif %}
```

`button.stories.js`:

```js
import buttonTwig from './button.twig';
import { renderTwig } from '@emulsify/core/storybook';

const context = (args) => ({
  text: args.text,
  url: args.url,
  icon: args.icon,
  modifiers: args.modifiers,
});

export default {
  title: 'Components/Button',
  render: renderTwig(buttonTwig, { context }),
  args: {
    text: 'Read more',
    url: '#',
    icon: '→',
    modifiers: ['primary'],
  },
};

export const Default = {};
```

## React Button Example

`Button.jsx`:

```jsx
import './button.scss';

export function Button({
  text = 'Read more',
  url,
  icon,
  modifiers = [],
  onClick,
}) {
  const classes = [
    'button',
    ...modifiers.map((modifier) => `button--${modifier}`),
  ].join(' ');

  const content = (
    <>
      <span className="button__text">{text}</span>
      {icon ? (
        <span className="button__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
    </>
  );

  if (url) {
    return (
      <a className={classes} href={url}>
        {content}
      </a>
    );
  }

  return (
    <button className={classes} type="button" onClick={onClick}>
      {content}
    </button>
  );
}
```

`button.stories.jsx`:

```jsx
import { Button } from './Button';

export default {
  title: 'Components/Button',
  component: Button,
  args: {
    text: 'Read more',
    url: '#',
    icon: '→',
    modifiers: ['primary'],
  },
};

export const Default = {};
```

## React In Drupal Themes

Emulsify Core does not generate `*.libraries.yml`. Drupal libraries remain owned by the project or theme so each implementation can choose dependencies, loading strategy, attributes, and attachment points.

A common Drupal SDC pattern is:

- Author the React component in a colocated `.jsx` file, such as `Card.jsx`.
- Add a separate mount entry, such as `mount.jsx`, that imports the component and registers a `Drupal.behaviors` attachment with `once`.
- Render a Twig mount element with JSON props.
- Define the Drupal library in the theme and attach the emitted `.js` bundle from Twig or component metadata.

```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Card } from './Card.jsx';

Drupal.behaviors.card = {
  attach(context) {
    once('card', '[data-card-root]', context).forEach((element) => {
      const propsScript = element.querySelector('[data-card-props]');
      const props = propsScript ? JSON.parse(propsScript.textContent) : {};

      createRoot(element).render(<Card {...props} />);
    });
  },
};
```

```twig
<div data-card-root>
  <script type="application/json" data-card-props>
    {{ card_props|json_encode|escape('html') }}
  </script>
</div>
```

```yaml
card:
  js:
    components/card/mount.js: {}
  dependencies:
    - core/drupal
    - core/once
```

## Shared Sass/CSS

Twig and React components can share class naming conventions and styles, but they do not have to share implementation details.

```scss
.button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  text-decoration: none;
}

.button--primary {
  font-weight: 700;
}

.button__icon {
  line-height: 1;
}
```

Sass files in supported component roots are included in the Vite build. Files beginning with `_` are treated as partials and are excluded from direct build entry generation. Storybook-specific styles using `cl-*` or `sb-*` naming are routed to Storybook output paths.
