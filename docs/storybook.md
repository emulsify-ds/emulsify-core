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

## Legacy Twig Story Compatibility

Older Emulsify stories often export functions that call an imported Twig template directly and return the rendered HTML string:

```js
import template from './accordion.twig';

export const Accordion = (args) =>
  template({
    accordion__heading: args.heading,
  });
```

Those stories still render in Emulsify Core. The shared Storybook preview wraps plain string results as HTML so projects can upgrade without rewriting every component immediately. It also tolerates older decorators that stringify `story()` for Twig stories. React stories and stories that already return React elements pass through unchanged.

`renderTwig()` remains the preferred pattern for new or actively migrated Twig stories because it makes the Twig/React Storybook boundary explicit:

```js
import template from './accordion.twig';
import { renderTwig } from '@emulsify/core/storybook';

const context = (args) => ({
  accordion__heading: args.heading,
});

export default {
  title: 'Components/Accordion',
  render: renderTwig(template, { context }),
};

export const Accordion = {};
```

Generated projects can include legacy Twig story checks in the full project
readiness audit with:

```sh
npm run audit
```

The full audit scans normalized Emulsify source roots and checks Twig
`include()` and `source()` references, CSS asset URLs, Webpack-era patterns,
platform assumptions, and public Emulsify Core import paths.

Projects with `@emulsify/core` installed can call the package binary directly:

```sh
npx --no-install emulsify-audit
```

From an Emulsify Core checkout, pass the project root explicitly:

```sh
node scripts/audit.js --root /path/to/project
```

For only the Twig story migration report, use `npm run audit:twig-stories` from this repo or `npx --no-install emulsify-audit-twig-stories` from a consuming project.

Add `--fail-on-found` when using the audit in CI during a migration push.

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
- Compiled template dependency support for `{% include %}`, `{% embed %}`, `{% extends %}`, `{% import %}`, and `{% from %}`.
- Optional platform Twig extensions supplied by the active adapter.

Drupal-specific Twig filters are not part of the generic Twig runtime. They are registered only when the active platform adapter enables them.

## Twig Import Performance

Storybook's Twig resolver uses Vite `import.meta.glob()` calls generated from the normalized project structure model. It eagerly imports compiled Twig template modules, then lazy-loads raw Twig template source and text asset source only when `source()` asks for them:

- Template modules support `{% include %}`, `{% embed %}`, `{% extends %}`, `{% import %}`, and `{% from %}` dependencies.
- Lazy raw Twig source imports support `source('@components/...')`.
- Lazy text asset imports support `source('@assets/...')` for SVG, HTML, Twig, CSS, JavaScript, JSON, TXT, and Markdown files.

Compiled template modules stay eager because Twig stories need synchronous render functions. Raw source and text asset strings are cached after the first request. The first render that asks for a lazy source may render without it while the dynamic import resolves; Emulsify re-renders the Twig story and subsequent renders read the cached string synchronously.

This keeps all configured Twig namespaces available at render time without retaining every raw Twig or text asset string in memory. Large libraries can still see Storybook output from compiled module imports, but raw strings are retained only for templates and assets that `source()` actually reads.

Large projects should keep Storybook-facing Twig roots intentional:

- Keep active story templates under supported component or structure roots.
- Keep generated, archived, or CMS-only Twig files outside Storybook source roots when they do not need to render in Storybook.
- Use `variant.structureImplementations` to make source roots explicit when a project has multiple areas such as `components`, `foundation`, `layout`, and `tokens`.
- Avoid placing large raw text fixtures under Twig roots unless `source()` needs them.

Release validation includes a larger Twig Storybook fixture. To collect repeatable local measurements, run:

```sh
npm run fixtures:release
```

To run only that measurement fixture:

```sh
npm run fixtures:release -- --fixture large-twig-storybook
```

The `large-twig-storybook` fixture prints Storybook build time, static output size, and the generated Twig component count. Those numbers are intended for trend comparison between branches and machines, not as fixed performance budgets.

A lazy resolver/cache model is feasible later because the resolver already centralizes template and source lookup behind `createTwigResolver()`. That change should be handled separately from this release because it would alter how Twig modules are loaded, watched, and cached in Storybook.

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

Text assets such as SVG, HTML, Twig, CSS, JavaScript, JSON, TXT, and Markdown are resolved from a build-time virtual module when they live under configured asset roots. Emulsify uses `projectStructure.assetRoots` when available, otherwise existing `src/assets` and `assets` directories. The first call lazy-loads the raw text and triggers a re-render; later calls return the cached text synchronously.

Raster image assets still produce image markup. Other assets return a public URL.

The old synchronous XHR fallback for text assets is disabled by default because it blocks Storybook rendering. It remains available for one release cycle only for assets outside the virtual asset roots:

```js
export const platformAdapter = {
  storybook: {
    allowSyncXhrSource: true,
  },
};
```

Move text assets used by `source('@assets/...')` into `src/assets`, `assets`, or a configured asset root instead. The sync-XHR fallback is deprecated and will be removed in 4.2.

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
