# Asset References

Use the project root `assets/` directory for static files that components need
at runtime, such as fonts, inline SVGs, background images, and other media.
Projects can also add custom asset roots with
`assets.roots` in `project.emulsify.json`.

```text
assets/
  fonts/
    example/
      Example-Regular.woff2
      Example-Regular.woff
  icons/
    refresh.svg
  images/
    example.png
```

Projects that keep Storybook text assets in additional directories can declare
custom asset roots in `project.emulsify.json`:

```json
{
  "assets": {
    "roots": ["./design-system/assets", "./prototype-assets"]
  }
}
```

Configured roots are resolved relative to the project root. Paths that resolve
outside the project are ignored. Existing root `assets/` and `src/assets/`
directories are always included for `@assets` source lookups.

## Sass And CSS

Sass and CSS should reference project assets with `/assets/...` URLs.

```scss
$font-url: '/assets/fonts/example';

@font-face {
  font-family: 'Example Sans';
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  src:
    url('#{$font-url}/Example-Regular.woff2') format('woff2'),
    url('#{$font-url}/Example-Regular.woff') format('woff');
}
```

```scss
.button__icon {
  background-image: url('/assets/icons/refresh.svg');
}
```

Storybook mounts existing configured asset roots at `/assets`, so these URLs
work in stories. During the Vite build, Emulsify resolves the URL against those
same roots and rewrites the reference to a path relative to the emitted CSS
file. That lets built CSS under `dist/` or mirrored component output resolve
the same project assets without hard-coding a platform-specific theme path.

The build does not copy the asset. `dist/` holds build output; `assets/` is
source, already web-served from the theme root, so the rewritten URL climbs out
of the output directory to reach it — `dist/components/card/css/card.css`
references `../../../../assets/images/hero.jpg`. One copy of every image, and
`dist/` stays limited to compiled and generated files. The one asset that is
genuinely build output, the `dist/assets/icons.svg` sprite, is referenced
inside `dist/` as usual.

Two consequences worth knowing. `dist/` is not self-contained: deploying it
without the theme's `assets/` directory alongside it will break these URLs.
And a configured `assets.roots` directory is reached where it really is
(`../../../../design-system/assets/logo.svg`), not through the `/assets`
alias Storybook serves it under.

Avoid Sass URLs that hard-code a platform or deployment directory. They may work
in one runtime, but they bypass Storybook's static asset mount and make the
component library less portable.

### Why A Relative Path Is Not Portable

A relative URL such as `url('../../assets/images/hero.jpg')` is a common way to
reach the same file, and on a Drupal theme with Single Directory Components it
appears to work. It does so by accident. Mirrored component CSS lands at
`components/<name>/<name>.css`, exactly two levels below the theme root, so a
two-level climb finds `assets/`. Change nothing but the output shape and the
same URL breaks:

| Project shape         | Emitted CSS                                 | `../../assets/images/hero.jpg` reaches |
| --------------------- | ------------------------------------------- | -------------------------------------- |
| Drupal SDC (mirrored) | `components/card/card.css`                  | `assets/images/hero.jpg`               |
| Non-SDC               | `dist/components/card/css/card.css`         | `dist/components/assets/…`             |
| Structure overrides   | `dist/css/src/foundation/colors/colors.css` | `dist/css/src/foundation/assets/…`     |

The build repairs this. When a `url()` Vite could not resolve names the
published `assets/` prefix, and that path matches exactly one file under exactly
one asset root, Emulsify rewrites it to `/assets/...`, which the relativizer
then points at the file — so every output shape gets the depth it needs. The
bare `url('assets/...')` form is repaired the same way.

The repair is reported, not silent. A one-shot build prints what it rewrote, and
`emulsify-audit --fix` writes the canonical form back into the stylesheet in one
pass. Prefer fixing the source: the repair only fires when one file answers to
the URL, and a project with the same filename under two asset roots gets a
warning and no rewrite.

To turn the repair off, set `assets.rebase` to `false`:

```json
{
  "assets": {
    "roots": ["./design-system/assets"],
    "rebase": false
  }
}
```

`EMULSIFY_ASSET_REBASE=0` does the same for a single build, which is the quicker
way to check whether the repair is involved in something unexpected.

Set `EMULSIFY_STRICT_ASSETS=1` to fail a build on any CSS asset URL that cannot
be resolved, or `=2` to also fail on URLs the build had to repair.

## Twig

Twig uses the `@assets` alias when a template needs to read or render an asset
through Emulsify's Storybook Twig helpers.

```twig
{{ source('@assets/icons/refresh.svg')|raw }}
```

For text assets such as SVG, HTML, Twig, CSS, JavaScript, JSON, TXT, and
Markdown, `source('@assets/...')` reads from `assets.roots` and always includes
existing root `assets` and `src/assets` directories. Root `./assets` is checked
before `./src/assets`.

```json
{
  "assets": {
    "roots": ["./design/assets"]
  }
}
```

The generated SVG sprite is a special case:

```twig
{{ source('@assets/icons.svg')|raw }}
```

That resolves `dist/assets/icons.svg` before checking root `assets/icons.svg`.
Other SVG references, such as `source('@assets/icons/refresh.svg')`, resolve
from project-authored asset roots.

For raster images, fonts, and other binary assets, `source('@assets/...')`
returns a public `/assets/...` URL or image markup instead of inlining file
contents. In Sass and CSS, use `/assets/...` directly rather than `@assets`.

Inline text assets are bundled for Storybook only. Storybook needs each one as a
string so `source()` can return it synchronously; a theme's `vite build` does
not, and bundling them there would copy the asset tree into `dist/` as
JavaScript. In a theme build `source('@assets/...')` resolves public assets over
the network instead.
