# Storybook

Emulsify Core uses `@storybook/react-vite`. React components render directly through Storybook's React framework, and Twig templates render through Emulsify's Twig story helper.

## Twig Stories

Twig imports are transformed into render functions that return HTML strings. Use `renderTwig()` from `@emulsify/core/storybook` to adapt those functions to React-based Storybook stories.

```js
import template from './card.twig';
import { renderTwig } from '@emulsify/core/storybook';

export default {
  title: 'Components/Card',
  render: renderTwig(template),
  args: {
    heading: 'Example',
    body: 'Twig rendered inside React Storybook.',
  },
};

export const Default = {};
```

`renderTwig()` passes Storybook args as Twig context, re-renders when args change, and attaches platform behavior only when the active platform adapter enables it.

## React Stories

React stories use standard Storybook React patterns.

```jsx
import { Card } from './Card';

export default {
  title: 'Components/Card',
  component: Card,
  args: {
    heading: 'Example',
    body: 'React rendered in the same Storybook instance.',
  },
};

export const Default = {};
```

Twig and React stories are discovered from the same normalized story roots. They can share title hierarchy, Sass conventions, global preview configuration, and addons.

## Storybook Twig Runtime

Twig support in Storybook is optional and platform-agnostic. When Twig stories are used, Emulsify Core configures Twig.js with:

- Native Emulsify Twig helpers such as `bem()` and `add_attributes()`.
- Native Emulsify Twig logic tags such as `switch`, `case`, `default`, and `endswitch`.
- Storybook runtime support for `include()` and `source()`.
- Optional platform Twig extensions supplied by the active adapter.

Drupal-specific Twig filters are not part of the generic Twig runtime. They are registered only when the active platform adapter enables them.

## `include()`

`include()` resolves templates through the normalized project structure model. References can use configured Twig namespaces such as `@components`, `@foundation`, `@layout`, or `@tokens` when those roots exist in `project.emulsify.json`.

```twig
{{ include('@components/icon/icon.twig', {
  name: 'arrow-right'
}) }}
```

The runtime supports explicit variables, `with_context`, `ignore_missing`, and ordered template candidates:

```twig
{{ include([
  '@components/card/card.twig',
  '@components/fallback/fallback.twig'
], {
  heading: 'Example',
  with_context: true,
  ignore_missing: true
}) }}
```

## `source()`

`source()` can return raw Twig source from the same normalized template roots.

```twig
<pre>{{ source('@components/button/button.twig') }}</pre>
```

It also supports the Storybook asset alias `@assets` for static assets served from the project asset directory.

```twig
{{ source('@assets/icons/arrow.svg') }}
{{ source('@assets/images/example.png') }}
```

Text assets such as SVG, HTML, Twig, CSS, JavaScript, JSON, TXT, and Markdown are inlined when available. Raster image assets produce image markup. Other assets return a public URL.

## Mixed Twig And React Folder Example

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

Both stories appear in the same Storybook instance and can be organized by the same title hierarchy.

## Preview Overrides

Projects can provide `config/emulsify-core/storybook/preview.js` to override or extend Storybook preview parameters. Missing override files are ignored. Default a11y parameters remain in place unless explicitly overridden.

```js
export const parameters = {
  layout: 'centered',
  a11y: {
    config: {
      detailedReport: false,
    },
  },
};
```

Preview head and manager head HTML remain separate extension points through:

- `config/emulsify-core/storybook/preview-head.html`
- `config/emulsify-core/storybook/manager-head.html`
