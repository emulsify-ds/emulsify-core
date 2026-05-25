# Component Authoring

Emulsify Core supports component-driven development with Vite and Storybook. Twig-based components and React components are both complete, intentional authoring models. A project can be Twig-first, React-first, or intentionally mixed.

## Choosing An Authoring Model

Twig is a good fit for CMS themes and server-rendered template systems where production markup is rendered by Twig. Drupal has a dedicated adapter today. Craft CMS, WordPress + Timber, and other Twig-based CMS projects can use the generic adapter unless they need project-specific integration code.

React is a good fit for standalone UI packages, application components, and design systems consumed by React applications.

Mixed libraries use Twig and React in the same Storybook instance. This works well when a design system needs to document both CMS-rendered components and JavaScript-rendered application components.

## Twig Component Libraries

Twig imports are transformed into render functions that accept Storybook args as Twig context. Use `renderTwig()` from `@emulsify/core/storybook` to render imported Twig templates in React-based Storybook.

```js
import template from './button.twig';
import { renderTwig } from '@emulsify/core/storybook';

export default {
  title: 'Components/Button',
};

export const Default = {
  render: renderTwig(template),
  args: {
    text: 'Read more',
  },
};
```

Storybook's Twig runtime supports Emulsify's native Twig helpers plus `include()` and `source()` through the normalized project structure model. Drupal-specific Twig filters are registered only when the active platform adapter enables Drupal behavior.

## React Component Libraries

React components render through Storybook's React/Vite support. Storybook discovers React stories from the same normalized story roots as Twig stories. The shared Storybook globs include `*.stories.js`, `*.stories.jsx`, `*.stories.ts`, and `*.stories.tsx`; fixture coverage validates JavaScript/JSX stories.

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
      badge.stories.jsx
      badge.scss
```

Both stories appear in the same Storybook instance. Twig stories should use `renderTwig()` for imported Twig templates when authored or actively migrated. Older Twig stories that return HTML strings directly remain compatible through the shared Storybook preview. React stories use standard Storybook React component or render-function patterns.

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
import template from './button.twig';
import { renderTwig } from '@emulsify/core/storybook';

export default {
  title: 'Components/Button',
  render: renderTwig(template),
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
