# Project Structure And Output

Emulsify Core reads `project.emulsify.json` once and normalizes project structure for Vite, Storybook, Twig namespaces, and copy behavior.

## Which Structure Should I Use?

| Project Type                                 | Recommended Structure                        | Platform Setting      | Notes                                                                                                                         |
| -------------------------------------------- | -------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| New generic design system                    | `src/components`                             | `generic`             | Good default for Twig, React, or mixed component libraries that do not need CMS-specific output behavior.                     |
| Existing root `./components` project         | Keep `./components`                          | `generic` or `drupal` | Valid for upgrades. Do not create `src/` only to satisfy Emulsify Core.                                                       |
| Drupal SDC theme                             | `src/components` with SDC enabled            | `drupal`              | Builds through `dist/components` and mirrors component output to root `./components` for Drupal consumption.                  |
| Multi-root design system                     | `variant.structureImplementations`           | `generic` or `drupal` | Use explicit named roots such as `components`, `foundation`, `layout`, and `tokens`.                                          |
| CMS Twig project without a dedicated adapter | `src/components` or explicit structure roots | `generic`             | Use this for Craft CMS, WordPress + Timber, or similar Twig-based projects today. Dedicated adapters are not implemented yet. |

## Supported Project Structures

### `src/components`

`src/components` is the recommended structure for new projects.

```text
src/
  components/
    button/
      button.twig
      button.stories.js
      button.scss
```

When `src/` exists, global styles and scripts can live elsewhere under `src/`, outside `src/components` and `src/util`.

### Root `./components`

Root `./components` remains valid for existing projects.

```text
components/
  button/
    button.twig
    button.stories.js
    button.scss
```

Projects using this structure do not need to create `src/` just to use the current build system. Generic builds emit into `dist/`; Drupal SDC mirroring happens only when the Drupal adapter enables it.

### `variant.structureImplementations`

`variant.structureImplementations` is explicit configuration in `project.emulsify.json`. When present, those directories are respected above fallback discovery.

```json
{
  "project": {
    "platform": "generic",
    "name": "example",
    "machineName": "example"
  },
  "variant": {
    "structureImplementations": [
      { "name": "components", "directory": "./src/components/" },
      { "name": "foundation", "directory": "./src/foundation/" },
      { "name": "layout", "directory": "./src/layout/" },
      { "name": "tokens", "directory": "./src/tokens/" }
    ]
  }
}
```

Each implementation name becomes a structure root and Twig namespace, so templates can reference names such as `@components`, `@foundation`, `@layout`, and `@tokens`. Configured paths that resolve outside the project root are ignored.

## Story Roots

Stories remain colocated with components. Storybook discovers stories from the normalized source roots regardless of whether a project uses:

- `src/components`
- root `./components`
- one or more `variant.structureImplementations` directories

Supported story extensions are `*.stories.js`, `*.stories.jsx`, `*.stories.ts`, and `*.stories.tsx`. Release fixture coverage validates JavaScript/JSX stories.

## Twig Namespace Roots

Twig namespaces are derived from the same normalized project structure. For explicit structure implementations, each configured name becomes a namespace.

```twig
{{ include('@components/button/button.twig') }}
{{ include('@foundation/icon/icon.twig') }}
{{ include('@layout/grid/grid.twig') }}
{{ source('@tokens/colors/colors.twig') }}
```

For fallback structures, Emulsify Core exposes `@components` when a component root exists and may expose roots such as `@layout` or `@tokens` when those directories exist.

## Output Path Matrix

The Vite outDir is `dist/` unless a platform adapter performs additional work after build. The release fixture suite asserts the paths below.

| Project type                               | JS output                                                                                                                                                              | CSS output                                                                                                                                                              | Twig output                                                                                       | Component metadata                                    | Assets                                                                                                                  | Storybook styles                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/components` generic project           | `dist/components/<name>/js/<file>.js`; `.js` and `.jsx` entries both emit `.js`; global JS under `dist/global/**/js/*.js`                                              | `dist/components/<name>/css/<file>.css`; global CSS under `dist/global/**/css/*.css`                                                                                    | `dist/components/<name>/<file>.twig`                                                              | `dist/components/<name>/*.component.yml` when present | `dist/components/<name>/<asset>`                                                                                        | `dist/storybook/<source-path>/<cl-or-sb-file>.css`           |
| `src/components` Drupal SDC project        | Mirrored to `components/<name>/<file>.js`; `.jsx` source is compiled, not copied                                                                                       | Mirrored to `components/<name>/<file>.css`                                                                                                                              | Mirrored to `components/<name>/<file>.twig`                                                       | Mirrored to `components/<name>/*.component.yml`       | Mirrored to `components/<name>/<asset>`                                                                                 | `dist/storybook/<source-path>/<cl-or-sb-file>.css`           |
| Root `./components` project                | `dist/components/<name>/js/<file>.js`; `.js` and `.jsx` entries both emit `.js`                                                                                        | `dist/components/<name>/css/<file>.css`                                                                                                                                 | `dist/components/<name>/<file>.twig`                                                              | `dist/components/<name>/*.component.yml` when present | `dist/components/<name>/<asset>`                                                                                        | `dist/storybook/<component-path>/<cl-or-sb-file>.css`        |
| `variant.structureImplementations` project | Component-root JS/JSX can emit as `dist/js/<name>/<file>.js`; non-`components` roots preserve project-relative paths such as `dist/js/src/foundation/colors/colors.js` | Component-root CSS can emit as `dist/css/<name>/<file>.css`; non-`components` roots preserve project-relative paths such as `dist/css/src/foundation/colors/colors.css` | Copied under each named root, such as `dist/components/**`, `dist/layout/**`, or `dist/tokens/**` | Copied under the named root when present              | Copied under the named root, such as `dist/components/button/button.asset.txt` or `dist/foundation/colors/palette.json` | `dist/storybook/<project-relative-path>/<cl-or-sb-file>.css` |
| React-only Storybook project               | Storybook builds React stories directly; Vite entry output applies to discovered `.js`, `.jsx`, and `.scss` files in supported roots                                   | Same Sass routing as the matching project structure                                                                                                                     | Not emitted unless Twig files exist                                                               | Not emitted unless component metadata exists          | Copied when non-code assets exist in supported roots; `.jsx` source is excluded from static copying                     | Same Storybook style routing as the matching project         |

## Entry And Copy Rules

Emulsify Core preserves current exclusion behavior for build inputs:

- Partial Sass files are not direct build entries.
- Stories are not compiled as production component assets.
- Component metadata is copied, not compiled.
- Minified files are excluded from entry generation.
- Test files are excluded from entry generation.
- Eligible `.jsx` files are compiled as production entries and emitted with `.js` filenames.
- `.jsx` source files are excluded from static asset copying.
- `cl-*` and `sb-*` Storybook styles are routed to Storybook output paths.

Asset copying and entry generation both consume the normalized project structure model so roots, namespaces, and output paths stay aligned.

For Drupal projects, Core mirrors built SDC output when the Drupal adapter enables it, but library definitions stay project-owned. Core does not generate `*.libraries.yml`; themes should define libraries for the emitted bundles they attach.
