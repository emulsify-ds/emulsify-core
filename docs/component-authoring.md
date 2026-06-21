# Component Authoring

Emulsify Core supports component-driven development with Vite and Storybook. Twig-based components and React components are both complete, intentional authoring models. A project can be Twig-first, React-first, or intentionally mixed.

## Choosing An Authoring Model

Twig is a good fit for CMS themes and server-rendered template systems where production markup is rendered by Twig. Drupal has a dedicated adapter today. Craft CMS, WordPress + Timber, and other Twig-based CMS projects can use the `none` adapter unless they need project-specific integration code.

React is a good fit for standalone UI packages, application components, and design systems consumed by React applications.

Mixed libraries use Twig and React in the same Storybook instance. This works well when a design system needs to document both CMS-rendered components and JavaScript-rendered application components.

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

Storybook's Twig runtime supports Emulsify's native Twig helpers plus `include()` and `source()` through the normalized project structure model. Drupal-specific Twig filters are registered only when the active platform adapter enables Drupal behavior.

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

## Mixed Twig And React Storybook Libraries

Twig and React stories can share the same title hierarchy, Storybook addons, Sass conventions, and project structure. They do not need to share implementation details.

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
```

Both stories appear in the same Storybook instance. Twig stories should use `renderTwig(template, { context })` for imported Twig templates when authored or actively migrated. Older Twig stories that return HTML strings directly remain compatible through the shared Storybook preview, but the `renderTwig()` shape is easier to maintain because it makes the Twig context mapping explicit. React stories use standard Storybook React component or render-function patterns. A colocated `.jsx` mount file can be used as the production Vite entry when a CMS needs a browser bundle for that React component.

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
