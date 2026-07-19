# Release Verification

Emulsify Core 4.3.0 supports consumers on Node.js 24.13.0 or later. The
strictest published toolchain dependency, `stylelint-selector-bem-pattern` 5,
requires that patch. The published Babel 8 dependencies independently exclude
Node.js 24.0 through 24.10, while the Stylelint plugin also excludes Node.js
24.11 and 24.12.

Repository development recommends the exact Node.js 24.13.0 version pinned in
`.nvmrc`. Every CI and release workflow reads `.nvmrc`, so automation uses that
same exact version. Maintained scripts derive the supported consumer floor from
`package.json#engines.node`.

Do not publish from a local checkout unless maintainers have explicitly
approved the release. Use these steps to verify release readiness before
publishing.

## Required Local Verification

Install the locked dependencies in a clean checkout, then run the aggregate
release verification command:

```sh
npm ci
npm run release:verify
```

`release:verify` intentionally does not install dependencies. It runs:

- linting and unit tests;
- the repository Storybook build;
- every release fixture;
- every packed generated-consumer fixture and supported React peer version;
- a no-script package dry run;
- the packed-package smoke test; and
- the non-publishing release analysis.

CI runs the corresponding checks, although it keeps the expensive fixture and
packed-package work in parallel jobs for faster feedback. The authenticated
semantic-release dry run and real publish are not pull-request checks; they are
reserved for the trusted `main` workflow or the maintainer-only local
verification described below.

## Required CI Checks

The read-only CI workflow in `.github/workflows/lint.yml` divides release
readiness into five groups:

- `release-readiness` runs linting, unit tests—including package-export and
  package-content assertions—and the repository Storybook build.
- `fixture-builds` runs each release fixture in its own matrix job.
- `package-readiness` generates npm's no-script dry-run package manifest,
  installs the tarball in a clean temporary consumer, and tests the packed
  package. Release analysis also runs in this job for pull requests targeting
  `main`.
- `consumer-fixtures` installs the packed package into the Whisk-like Drupal,
  `none`, and WordPress/Twig consumer shapes in separate matrix jobs.
- `react-peer-fixtures` builds the packed mixed Storybook consumer with React
  and React DOM 18.3.1 and 19.2.7.

For pull requests targeting `main`, the packed-package job runs both tarball
checks before predicting the semantic release from the latest release tag
through Actions' checked-out prospective merge commit. It separately combines
current base history with the pull request title as a prospective squash
commit, guarding against an accidental merge-strategy change that would
discard the analyzed commits.

The CI workflow has only `contents: read` permission. It cannot publish to npm,
push a tag, or create a GitHub release. The separate publish workflow runs only
after a push to `main`.

### Release Fixtures

The release fixture suite validates the 4.x checklist items that are easy to
automate:

- `drupal-sdc-src-components` builds Drupal SDC component sources and verifies mirrored root `components/` output while rejecting stale `dist/components/` component files.
- `no-platform-src-components` verifies `none` platform output stays in `dist/` and rejects Drupal globals such as `window.Drupal`, `Drupal.behaviors`, and `attachBehaviors` in emitted JavaScript.
- `wordpress-src-components` verifies the WordPress adapter keeps global assets under `dist/global`, component output under `dist/components`, avoids root `components/` mirroring, and rejects Drupal globals in emitted JavaScript.
- `legacy-components` verifies that projects using the legacy `components/`
  source layout continue to build into `dist/components/`.
- `structure-implementations` verifies custom structure mappings for component
  JavaScript, CSS, Twig, Storybook CSS, foundation assets, and design tokens.
- `mixed-storybook` first verifies that Twig stories using `renderTwig()`,
  React stories, and autonomous custom-element stories build together. It then
  serves that built Storybook in headless Chromium and exercises real
  Storybook controls. The browser assertions cover a no-reload property update,
  object/array property preservation, omitted-property cleanup, boolean
  attribute addition and removal, default-slot assignment, and a mapped native
  `CustomEvent`.
- The mixed Storybook browser check also runs axe directly against the fixture
  custom element and proves that scan reaches its open shadow-root button. This
  targeted assertion does not claim that the Storybook accessibility addon
  scans every shadow-root implementation.
- `large-twig-storybook` generates 80 Twig components, builds their stories,
  and guards the emitted JavaScript size against the recorded pre-optimization
  baseline.
- Twig helper and tag support is covered by unit tests and fixtures for `bem()`, `add_attributes()`, `switch`, `case`, `default`, and `endswitch`.

### Packed Consumer Fixtures

The executable consumer-contract suite verifies the package through the
installation model used by generated themes:

```sh
npm run fixtures:consumer
```

It packs Core, installs the tarball into clean temporary npm projects without
repository-local symlinks, and exercises representative Vite, Storybook,
ESLint, Stylelint, Jest, and Pa11y/axe workflows. The fixture shapes model
Drupal Whisk, a `none` platform theme, WordPress/Twig, and a mixed Twig, React,
and custom-element Storybook. The mixed fixture is built with the exact React
peer test versions 18.3.1 and 19.2.7.

CI splits the three platform shapes and the two React peer versions into
parallel jobs. The aggregate `release:verify` command runs the same contract
sequentially. See [Dependency Contract](./dependency-contract.md) for the
fixture-to-consumer mapping, npm flat-layout support boundary, and snapshot
update procedure.

## Tarball Smoke Test

Run the packed-package checks independently with:

```sh
npm run pack:dry-run
npm run smoke:pack
```

The package dry run asks npm to calculate and print the exact package manifest
without running lifecycle scripts. Package-export tests in the unit suite use
the same manifest to assert that every public export, executable, and required
runtime import is included while tests, snapshots, coverage output, and
release-only internals are excluded. Those assertions include the audit
modules needed by the packaged command-line tools.

The smoke check creates the package tarball and installs it into a clean
temporary consumer without repository-local symlinks. It exercises
representative public Twig, React, Storybook, Vite, plugin, and platform APIs
from that installed tarball, including `defineCustomElement()` and
`renderWebComponent()`. It also runs the installed `emulsify-audit` executable
in JSON mode and confirms that Core's internal Twig asset-source runtime is not
exposed as a package subpath.

The packed consumer also builds a mixed Twig, React, and custom-element
Storybook using the installed package. That production build proves Core's
generated Twig module can load its internal asset-source runtime without
creating a consumer API, then confirms stable Twig and custom-element story
IDs are present in the generated output. Browser-level behavior for
control-driven DOM updates, native events, slot content, and accessibility is
covered by the `mixed-storybook` release fixture rather than repeated in this
packed smoke test. The smoke check removes its temporary consumer and tarball
when it finishes.

## Release Calculation

Run the safe release analyzer to see what semantic-release will calculate
without invoking any publishing plugins:

```sh
npm run release:analyze
```

The analyzer reads the commit range from the latest release tag through the
current revision and uses the same conventional-commit analyzer and custom
release rules as semantic-release. It reports the release type and predicted
version, and verifies that the prediction matches `package.json`, without
changing package metadata, creating a tag, creating a GitHub release, or
publishing to npm.

Emulsify's established `develop`-to-`main` release strategy uses GitHub's
**Create a merge commit** option. That preserves the individual conventional
commits analyzed by semantic-release. If a release pull request is squashed
instead, its title becomes the release commit. The title must itself produce a
semantic release, and the release calculated from unreleased base history plus
that title must match the full prospective merge range. This accounts for
release-producing commits that may already exist on the base branch. For
example, this title does not produce a release:

```text
Release(4.3.0): prepare the release
```

For a minor release, use a conventional title such as:

```text
feat(release): prepare 4.3.0
```

Use `fix(release): ...` for a patch. Breaking releases must retain an explicit
`BREAKING CHANGE:` footer by using the established merge-commit strategy. CI
rejects a `main` pull request when its title produces no release or when the
prospective squash history changes the full range's calculated release type.

## Maintainer-Only Semantic-Release Dry Run

The publish workflow lives at `.github/workflows/publish.yml` and runs only
after changes land on `main`. Before its separate publish step, the workflow
runs semantic-release with `--dry-run` using the trusted branch history and
release credentials. Dry-run mode calculates and verifies the release but does
not publish to npm, push a tag, or create a GitHub release.

The publish job grants `id-token: write` for npm trusted publishing, provides
`GITHUB_TOKEN` so the later publish step can push tags and create GitHub
releases, and provides `NPM_TOKEN` as the fallback token-based npm
authentication path.

When configuring npm trusted publishing for `@emulsify/core`, use `publish.yml` as the GitHub Actions workflow filename.

Maintainers can repeat the authenticated verification from a trusted `main`
checkout:

```sh
GITHUB_TOKEN="$GITHUB_TOKEN" NPM_TOKEN="$NPM_TOKEN" npx semantic-release --dry-run
```

The equivalent npm script form is:

```sh
npm run semantic-release -- --dry-run
```

This authenticated dry run is maintainer-only. Pull-request CI uses the local
release analyzer instead, so forked pull requests do not require or receive
publishing credentials.

Do not run `npm run semantic-release` without `--dry-run` until maintainers are
ready to publish the npm release.
