# Storybook

Emulsify Core uses `@storybook/react-vite`. React components render directly
through Storybook's React framework, Twig templates render through Emulsify's
Twig story helper, and autonomous custom elements render through a focused
custom-element adapter.

## Twig Stories

Twig imports are transformed into render functions that return HTML strings. Use `renderTwig()` from `@emulsify/core/storybook` to adapt those functions to React-based Storybook stories.

```js
import accordionTwig from './accordion.twig';
import { renderTwig } from '@emulsify/core/storybook';

const context = (args) => ({
  accordion__heading: args.heading,
  accordion__items: args.items,
});

export default {
  title: 'Components/Accordion',
  render: renderTwig(accordionTwig, { context }),
  args: {
    heading: 'Frequently asked questions',
    items: [],
  },
};

export const Default = {};
```

### Recommended Twig Story Pattern

Use `render: renderTwig(template, { context })` for new Twig stories and for stories you are actively editing. The `context` function is the place to translate Storybook args into the variable names the Twig template expects. Keeping that mapping next to the story makes the component contract easier to inspect, test, and maintain.

This pattern is preferred because it gives Storybook a normal React render function instead of a bare HTML string. Emulsify can then render the Twig output through its React-managed `TwigHtmlStory` wrapper, update the visible markup whenever controls change, re-render after lazy `source()` content finishes loading, and attach platform behaviors such as Drupal behaviors at the right time.

It also makes migration work clearer. The imported `.twig` module stays responsible only for rendering Twig. The story stays responsible for Storybook args, defaults, and control-friendly data shaping. That separation is especially useful when a Twig variable name follows CMS conventions such as `accordion__heading`, while the Storybook control can use a simpler name such as `heading`.

## Legacy Twig Story Compatibility

Older Emulsify stories often export functions that call an imported Twig template directly and return the rendered HTML string:

```js
import template from './accordion.twig';

export const Accordion = (args) =>
  template({
    accordion__heading: args.heading,
  });
```

Those stories still render in Emulsify Core. The shared Storybook preview routes plain string results, and legacy React story elements with Twig HTML stringification, through the same `TwigHtmlStory` wrapper used by `renderTwig()`. That wrapper uses React-managed HTML updates, so Storybook control changes update the visible markup without a manual refresh. React stories and stories that already return React elements pass through unchanged.

Legacy string-returning stories are supported as a compatibility path, not as the recommended authoring style. They can hide the args-to-Twig-context mapping inside arbitrary story code, which makes Storybook controls and future migrations harder to reason about. Prefer converting edited stories to `renderTwig(template, { context })`:

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

For the combined project audit, use `emulsify-audit --fail-on warn` when errors
and warnings should fail CI. The focused `emulsify-audit-twig-stories` command
continues to use `--fail-on-found`. See [Project Audit](audit.md) for the
versioned JSON schema and complete exit behavior.

## Pa11y Accessibility Checks

Build Storybook before running Pa11y so Storybook writes its generated
`index.json`:

```sh
npm run storybook-build
node scripts/a11y.js -r
```

Consuming projects can call the installed Core script:

```sh
node node_modules/@emulsify/core/scripts/a11y.js -r
```

By default, Pa11y reads Storybook story IDs from the built Storybook
`index.json` under `storybookBuildDir`. Manual IDs configured in
`config/emulsify-core/a11y.config.js` are merged with discovered IDs and
deduplicated, so projects can keep explicit coverage for stories that are not
present in the generated index:

```js
export default {
  components: ['components-manual-card--default'],
};
```

To run only manual IDs, disable discovery explicitly:

```js
export default {
  discoverStories: false,
  components: ['components-manual-card--default'],
};
```

If `index.json` is missing or malformed, the script prints a warning and falls
back to the configured manual IDs.

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

## Custom Element Stories

Custom-element stories use the browser custom element registry plus
`defineCustomElement()` and `renderWebComponent()` from
`@emulsify/core/storybook`.

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
    argsAs: 'properties',
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

`defineCustomElement()` validates the browser's custom-element name rules and
requires a constructable class whose prototype inherits from `HTMLElement`. It
is idempotent when the same tag and constructor are evaluated again. If HMR
supplies a different constructor for an existing tag, the helper warns and
returns the constructor already in the browser registry. The registry cannot
replace a definition, so refresh Storybook to use the new class.

`renderWebComponent()` applies Storybook args through the custom element's DOM
API. The `argsAs` option accepts only `properties` or `attributes` and reports a
configuration error for any other value. Property mode is the default and
preserves object, array, and function references:

```js
render: renderWebComponent('greeting-card', {
  argsAs: 'properties',
});
```

When a later args object omits a property that was previously applied, the
renderer assigns `undefined`. This lets custom setters clear their internal
state instead of retaining an earlier control value.

Attribute mode is available for elements that use attributes as their public
API. It stringifies values, writes `true` booleans as empty attributes, and
removes attributes for `false`, `null`, `undefined`, or a key omitted by a
later args object:

```js
render: renderWebComponent('greeting-card', {
  argsAs: 'attributes',
});
```

### Children And The Default Slot

`args.children` becomes React-managed light DOM inside the custom element. A
component with an unnamed `<slot>` can use it as straightforward default-slot
content:

```js
export const WithSupportingText = {
  args: {
    children: 'Supporting text',
  },
};
```

Strings are inserted as text, not HTML. React-renderable nodes are also
supported. When a later args object omits `children`, the old light DOM is
removed.

### Native Custom Events

Use the `events` option to map native event types to Storybook callback args:

```js
render: renderWebComponent('greeting-card', {
  events: {
    'greeting-select': 'onGreetingSelect',
  },
});
```

The mapped callback receives the original native `Event` or `CustomEvent`, so
custom payloads remain available through `event.detail`. The renderer updates
the listener when controls change and removes it on unmount. Mapped callback
args are not assigned as DOM properties or attributes, and React synthetic
event naming is not inferred. Assign Storybook's `fn()` to the callback arg, as
shown above, to record calls in the Actions panel and make the callback
available to interaction tests.

For events created inside a shadow root, dispatch from the custom-element host
or configure the event to bubble and cross the shadow boundary when that is the
component's intended public behavior.

### Wrapper, Class, And ID

Without a wrapper, renderer `id` and `className` options apply to the custom
element. With `wrapper`, those two options apply to the wrapper:

```js
render: renderWebComponent('greeting-card', {
  wrapper: 'section',
  id: 'greeting-card-story',
  className: 'story-frame',
});
```

Storybook args always target the custom element, even in wrapper mode. An arg
for `id` or `className` in property mode, or `id` or `class` in attribute mode,
wins while it is present. Renderer options such as `argsAs`, `events`, and
`wrapper` are never forwarded to the custom element.

### Known Limitations

- The adapter supports autonomous custom-element tags.
  `defineCustomElement()` rejects customized built-in constructors and
  registration options such as `{ extends: 'button' }`; markup such as
  `<button is="custom-button">` is not supported.
- `args.children` covers an unnamed default slot. There is no named-slot
  composition API in this initial release.
- Native events require an explicit `events` mapping. The renderer does not
  convert React-style `on*` args into native listeners.
- The custom element registry is permanent for the page. A different
  constructor supplied during HMR produces a warning and requires a full
  Storybook refresh.
- Shadow DOM components may need extra accessibility test configuration.
  Storybook's a11y addon and axe-based checks do not automatically inspect
  every shadow root in every setup; configure axe traversal when accessible UI
  lives inside a shadow tree.

## Storybook Twig Runtime

Twig support in Storybook is optional and platform-agnostic. When Twig stories are used, Emulsify Core configures Twig.js with:

- Native Emulsify Twig helpers such as `bem()` and `add_attributes()`.
- Native Emulsify Twig logic tags such as `switch`, `case`, `default`, and `endswitch`.
- Storybook runtime support for `include()` and `source()`.
- Compiled template dependency support for `{% include %}`, `{% embed %}`, `{% extends %}`, `{% import %}`, and `{% from %}`.
- Optional platform or project Twig extensions supplied by configuration.

Drupal-compatible Twig filters are not part of the default Twig runtime by
default. They are registered when the active platform adapter enables them, or
when a project sets `storybook.registerDrupalTwigFilters` in
`project.emulsify.json`. See
[Storybook Twig.js Extensions](extension-points.md#storybook-twigjs-extensions).

Imported Twig modules are isolated from each other at runtime. Each generated module creates its own Twig.js factory instance, registers Emulsify's Twig extensions, and preloads that module's transitive template dependencies into the local instance. This avoids global Twig template registry collisions without a shared template store or `Twig.Templates` monkey-patches.

## Twig Import Performance

Storybook's Twig resolver uses Vite `import.meta.glob()` calls generated from the normalized project structure model. It eagerly imports compiled Twig template modules, then lazy-loads raw Twig template source and text asset source only when `source()` asks for them:

- Template modules support `{% include %}`, `{% embed %}`, `{% extends %}`, `{% import %}`, and `{% from %}` dependencies.
- Generated Twig modules also support static `include()` function references through the same template dependency resolver.
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

Emulsify Core adds a Storybook runtime implementation of Twig's `include()` function. It resolves templates through the same normalized project structure model used by Twig tags, so imported Twig modules and Storybook-rendered templates can use the same reference forms.

References can use configured Twig namespaces such as `@components`, `@foundation`, `@layout`, or `@tokens` when those roots exist in `project.emulsify.json`.

```twig
{{ include('@components/icon/icon.twig', {
  name: 'arrow-right'
}) }}
```

Template tags use the same resolver:

```twig
{% include '@components/button/button.twig' %}
```

Project-scoped component IDs are also supported. The namespace segment is the consuming project or theme ID, followed by the component name:

```twig
{{ include('project_id:button', {
  label: 'Read more'
}) }}

{% include 'project_id:button' %}
```

Both namespace paths and project-scoped IDs can resolve grouped component folders. For example, `@components/button/button.twig` and `project_id:button` can resolve `src/components/ui/button/button.twig` when components are organized under a grouping directory such as `ui`.

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

Static `include()` function references are compiled into the generated Twig module's local dependency map. Dynamic template names can still be used when the active runtime resolver can resolve them, but static strings are preferred for predictable Storybook rendering and HMR.

## `source()`

`source()` can return raw Twig source from the same normalized template roots.

```twig
<pre>{{ source('@components/button/button.twig') }}</pre>
```

It also supports the Storybook asset alias `@assets` for static assets served from configured project asset roots.

```twig
{{ source('@assets/icons/arrow.svg') }}
{{ source('@assets/images/example.png') }}
```

Text assets such as SVG, HTML, Twig, CSS, JavaScript, JSON, TXT, and Markdown are resolved from a build-time virtual module when they live under configured asset roots. Projects can add custom roots with `assets.roots` in `project.emulsify.json`; Emulsify normalizes those paths into `projectStructure.assetRoots` and always includes existing root `assets` and `src/assets` directories. Root `./assets` is checked before `./src/assets` for `@assets` references.

```json
{
  "assets": {
    "roots": ["./design-system/assets", "./prototype-assets"]
  }
}
```

Configured asset roots must resolve inside the project root. Unsafe paths are ignored.

The generated sprite is a special asset alias: `source('@assets/icons.svg')` resolves `dist/assets/icons.svg` before checking root `assets/icons.svg`. Other `@assets/...` SVG references resolve through the project asset roots, so `source('@assets/icons/arrow.svg')` reads `assets/icons/arrow.svg` when that file exists.

The first text source call lazy-loads the raw text and triggers a re-render; later calls return the cached text synchronously.

Raster image assets still produce image markup. Font files and other binary assets return a public URL under `/assets/...`. Storybook serves root `./assets` at that URL prefix, so files such as `assets/images/example.png` and `assets/fonts/example.woff2` can be referenced with `source('@assets/images/example.png')` and `source('@assets/fonts/example.woff2')`.

For Sass and CSS, reference the same project files with `/assets/...` URLs
rather than the Twig-only `@assets` alias:

```scss
@font-face {
  font-family: 'Example Sans';
  src: url('/assets/fonts/example/Example-Regular.woff2') format('woff2');
}

.button__icon {
  background-image: url('/assets/icons/arrow.svg');
}
```

See [Asset References](asset-references.md) for more examples and for how these
URLs behave in Storybook and built platform CSS.

Legacy stories that use `require.context()` to list static assets are converted to a static key list for common asset extensions. This lets stories enumerate files such as `assets/icons/*.svg` without loading those SVGs as JavaScript modules.

The old synchronous XHR fallback for text assets is disabled by default because it blocks Storybook rendering. It remains available as a temporary compatibility fallback for assets outside the virtual asset roots:

```js
export const platformAdapter = {
  storybook: {
    allowSyncXhrSource: true,
  },
};
```

Move text assets used by `source('@assets/...')` into `src/assets`, `assets`, or a configured asset root instead. The sync-XHR fallback is deprecated and scheduled for removal in a future major release.

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
      mount.jsx
      badge.stories.jsx
      badge.scss
```

Both stories appear in the same Storybook instance and can be organized by the same title hierarchy. Storybook already supports React/JSX through `@storybook/react-vite`; production Vite builds also compile eligible colocated `.jsx` files, such as mount entries, to `.js` browser bundles.

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
