# Asset References

Use the project root `assets/` directory for static files that components need
at runtime, such as fonts, inline SVGs, background images, and other media.

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

Storybook mounts root `./assets` at `/assets`, so these URLs work in stories.
During the Vite build, Emulsify rewrites CSS `url('/assets/...')` and
`url('assets/...')` references to paths relative to the emitted CSS file. That
lets built CSS under `dist/` or mirrored component output resolve the same
project assets without hard-coding a platform-specific theme path.

Avoid Sass URLs that hard-code a platform or deployment directory. They may work
in one runtime, but they bypass Storybook's static asset mount and make the
component library less portable.

## Twig

Twig uses the `@assets` alias when a template needs to read or render an asset
through Emulsify's Storybook Twig helpers.

```twig
{{ source('@assets/icons/refresh.svg')|raw }}
```

For text assets such as SVG, HTML, Twig, CSS, JavaScript, JSON, TXT, and
Markdown, `source('@assets/...')` reads from configured asset roots and always
includes existing root `assets` and `src/assets` directories. Root `./assets`
is checked before `./src/assets`.

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
