# Release Verification

Emulsify Core 4.x supports Node.js 24 or later. This is the project policy for maintained 4.x scripts, CI, and release automation.

Do not publish from a local checkout unless maintainers have explicitly approved the release. Use these steps to verify release readiness before publishing.

## Required Checks

Run the repository checks from a clean checkout:

```sh
npm ci
npm run lint
npm test
npm run storybook-build
npm run fixtures:release
npm pack --dry-run --ignore-scripts --json
npm pack
```

The release fixture suite validates the 4.x checklist items that are easy to automate:

- `drupal-sdc-src-components` builds Drupal SDC component sources and verifies mirrored root `components/` output while rejecting stale `dist/components/` component files.
- `generic-src-components` verifies generic output stays in `dist/` and rejects Drupal globals such as `window.Drupal`, `Drupal.behaviors`, and `attachBehaviors` in emitted JavaScript.
- `mixed-storybook` verifies Twig stories using `renderTwig()` and React stories build together in one Storybook instance.
- Twig helper and tag support is covered by unit tests and fixtures for `bem()`, `add_attributes()`, `switch`, `case`, `default`, and `endswitch`.

## Tarball Smoke Test

After `npm pack`, install the generated tarball in a clean temporary project and verify public imports resolve from the packed package:

```sh
tmp="$(mktemp -d)"
cd "$tmp"
npm init -y
npm install /path/to/emulsify-core-4.0.0.tgz

node --input-type=module -e "
  const core = await import('@emulsify/core');
  const storybook = await import('@emulsify/core/storybook');
  const twig = await import('@emulsify/core/extensions/twig');
  const react = await import('@emulsify/core/extensions/react');
  const vite = await import('@emulsify/core/vite');
  const plugins = await import('@emulsify/core/vite/plugins');

  if (typeof storybook.renderTwig !== 'function') {
    throw new Error('renderTwig missing from @emulsify/core/storybook');
  }

  if (typeof twig.registerTwigExtensions !== 'function') {
    throw new Error('registerTwigExtensions missing from @emulsify/core/extensions/twig');
  }

  console.log('Public package imports resolved successfully.');
"
```

The unused imported bindings intentionally prove each documented public package export resolves from an installed tarball.

## Semantic-Release Dry Run

The release workflow publishes from `main` with token-based authentication. It provides `GITHUB_TOKEN` and `NPM_TOKEN`, and grants `contents: write` so semantic-release can push tags and create GitHub releases.

Before publishing, verify release authentication from a `main` checkout with a dry run:

```sh
GITHUB_TOKEN="$GITHUB_TOKEN" NPM_TOKEN="$NPM_TOKEN" npx semantic-release --dry-run
```

The equivalent npm script form is:

```sh
npm run semantic-release -- --dry-run
```

Do not run `npm run semantic-release` without `--dry-run` until maintainers are ready to publish the npm release.
