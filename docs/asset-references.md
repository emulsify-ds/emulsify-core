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

By default, the build keeps `dist/` self-contained. Vite copies the project
assets it resolves, and Emulsify emits matching copies for the bare and
wrong-depth forms Vite could not resolve. The final URL points at that copy —
`dist/components/card/css/card.css` references
`../../../assets/images/hero.jpg`. Mirrored Drupal SDC CSS outside the output
uses a path such as `../../dist/assets/images/hero.jpg`. Deploying `dist/`
therefore preserves the same asset contract as 4.3.2 while resolving more
authored URL forms.

Projects that deploy the whole theme directory can opt into leaner output:

```json
{
  "assets": {
    "selfContainedOutput": false
  }
}
```

In that mode, built CSS reaches the real source root instead — for example
`../../../../design-system/assets/logo.svg` — and a Vite-emitted copy is removed
only after an emitted CSS URL has been redirected successfully. Copies still
needed by JavaScript, HTML, or another non-CSS output remain in `dist/`. The
complete theme, including every configured `assets.roots` directory, must be
deployed together. Set `EMULSIFY_SELF_CONTAINED_OUTPUT=0` for the same one-build
opt-in; `false`, `off`, and `no` are accepted too.

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
way to check whether the repair is involved in something unexpected. This is
an end-to-end opt-out: Emulsify skips unresolved-URL repair, keeps Vite-emitted
project-asset copies in `dist/assets/`, and leaves Vite's emitted CSS URLs
untouched by the final relativizer. URLs Vite cannot resolve remain as authored.
This control is independent from `assets.selfContainedOutput`: disabling the
repair wins and leaves the whole pipeline unchanged regardless of the output
setting.

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
returns a public `./assets/...` URL or image markup instead of inlining file
contents. That URL is relative to Storybook's preview document, so a static
build resolves it correctly from a domain root and from any deployment subpath.
In Sass and CSS, use `/assets/...` directly rather than `@assets`.

Inline text assets are bundled for Storybook only. Storybook needs each one as a
string so `source()` can return it synchronously; a theme's `vite build` does
not, and bundling them there would copy the asset tree into `dist/` as
JavaScript. In a theme build `source('@assets/...')` resolves public assets over
the network instead.
