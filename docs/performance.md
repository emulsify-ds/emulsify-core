# Performance

Emulsify Core favors predictable output and simple project configuration. The defaults are suitable for small and medium component libraries, and the release fixtures cover the main supported structures. Larger libraries should keep source roots intentional and use the fixture commands below to compare changes.

## Production Sourcemaps

Vite production builds currently emit JavaScript and CSS sourcemaps:

```js
build: {
  sourcemap: true,
}
```

CSS dev sourcemaps are also enabled. Sourcemaps are useful during the release and migration window because they make compiled output easier to debug. They do increase `dist/` size. Projects that need a different production sourcemap policy can patch Vite config from `.config/emulsify-core/vite/plugins.*`:

```js
// .config/emulsify-core/vite/plugins.mjs
export const extendConfig = () => ({
  build: {
    sourcemap: false,
  },
});
```

## Storybook Twig Imports

Storybook's Twig resolver eagerly imports compiled Twig modules and raw Twig source strings with `import.meta.glob(..., { eager: true })`.

This supports:

- `include()` for Twig templates.
- `source()` for raw Twig source.
- Namespaces derived from `project.emulsify.json`.

The eager strategy is simple and reliable, but every `.twig` file under Storybook's resolved Twig roots is included in the preview build. Large projects with many generated, archived, or CMS-only Twig files can see larger Storybook output and slower builds.

For large libraries:

- Keep only active Storybook-rendered Twig files under Storybook source roots.
- Move generated or archived Twig files outside `src/components`, root `./components`, or explicit `variant.structureImplementations` roots when Storybook does not need them.
- Prefer explicit `variant.structureImplementations` roots when a repository has multiple source areas.
- Avoid storing large raw fixtures under Twig roots unless `source()` needs to read them.

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
