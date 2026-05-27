# Performance

Emulsify Core favors predictable output and simple project configuration. The defaults are suitable for small and medium component libraries, and the release fixtures cover the main supported structures. Larger libraries should keep source roots intentional and use the fixture commands below to compare changes.

## Production Sourcemaps

Vite production builds currently emit JavaScript and CSS sourcemaps:

```js
build: {
  sourcemap: true,
}
```

CSS dev sourcemaps are also enabled. Sourcemaps are useful during the release and migration window because they make compiled output easier to debug. They do increase `dist/` size. Projects that need a different production sourcemap policy can patch Vite config from `config/emulsify-core/vite/plugins.*`:

```js
// config/emulsify-core/vite/plugins.mjs
export const extendConfig = () => ({
  build: {
    sourcemap: false,
  },
});
```

## Storybook Twig Imports

Storybook's Twig resolver eagerly imports compiled Twig modules with `import.meta.glob(..., { eager: true })`, but raw Twig source strings for `source()` are loaded lazily.

This supports:

- `include()` for Twig templates.
- `source()` for raw Twig source, loaded on demand and cached after the first request.
- Namespaces derived from `project.emulsify.json`.

Compiled Twig modules stay eager because Storybook stories need synchronous render functions. Raw source loading is deferred because most projects call `source()` for only a small subset of templates. The first render that asks for a lazy raw source may render without that source while the dynamic import resolves; Emulsify then re-renders the Twig story and subsequent renders read the cached string synchronously.

Large projects with many generated, archived, or CMS-only Twig files can still see larger Storybook output from compiled module imports, but lazy raw source loading reduces the retained string heap for templates that never call `source()`.

For large libraries:

- Keep only active Storybook-rendered Twig files under Storybook source roots.
- Move generated or archived Twig files outside `src/components`, root `./components`, or explicit `variant.structureImplementations` roots when Storybook does not need them.
- Prefer explicit `variant.structureImplementations` roots when a repository has multiple source areas.
- Avoid storing large raw fixtures under Twig roots unless stories need to render or `source()` them.

## Tailwind Scanning

Tailwind CSS v4 can scan project sources automatically, but explicit `@source` lines make Emulsify structures easier to reason about:

```css
@import 'tailwindcss';

@source "../components";
@source "../../components";
@source "../foundation";
@source "../layout";
@source "../tokens";
```

Use only the roots your project actually uses. Do not point Tailwind at `dist/`, `.out/`, `node_modules/`, generated fixture output, or archived templates.

## Copied Files Versus Compiled Files

Emulsify Core compiles JavaScript and Sass/CSS entries. It copies Twig templates, component metadata, and static component assets.

Copied files are intentionally not transformed by Vite. This keeps CMS-facing templates and metadata predictable and avoids unnecessary build work. The copy pass uses the normalized project structure model so copied files land beside the matching compiled output.

## Validation Commands

Use these commands to compare release-readiness behavior:

```sh
npm run fixtures:release
```

Release fixtures live under `.github/fixtures/release/`. They are repository
development assets for CI and local validation, and are not included in the npm
package installed by consuming projects.

Run one fixture when debugging a specific project shape:

```sh
npm run fixtures:release -- --fixture generic-src-components
npm run fixtures:release -- --fixture mixed-storybook
npm run fixtures:release -- --fixture large-twig-storybook
```

List available fixtures:

```sh
npm run fixtures:release:list
```

The `large-twig-storybook` fixture reports Storybook build time, output size, and generated Twig component count. Treat those numbers as trend data for local comparison rather than fixed pass/fail budgets.
