# Release Verification

The supported consumer Node.js range comes from `package.json#engines.node`.
The current floor is Node.js 24.13.0 because the strictest published toolchain
dependency, `stylelint-selector-bem-pattern` 5, requires that patch.

Repository development recommends the exact Node.js 24.18.0 version pinned in
`.nvmrc`. Most CI jobs and the publish workflow read `.nvmrc`; the
`release-readiness` job runs on both the supported 24.13.0 floor and the
recommended 24.18.0 version. Maintained scripts derive the supported consumer
floor from `package.json#engines.node`.

Do not publish from a local checkout unless maintainers have explicitly
approved the release. Use these steps to verify release readiness before
publishing.

## Release Pull Request Review

A release branch merging into `main` must follow the
[Release Pull Request Review](release-review.md) checklist. The checklist
separates review of the Storybook API, Twig and Vite runtime, audit contract,
package surface, generated consumers, Node.js and dependencies, accessibility,
documentation, and release automation.

The release pull request must record evidence or a not-applicable reason for
every track. Its description must keep user-facing changes, migration impact,
internal architecture and performance changes, public exports, known
limitations, completed checks, outstanding work, and originating issues or
feature pull requests distinct. If no originating issue exists, explain that
briefly instead of writing only "None."

Review coverage may be divided among maintainers according to the repository's
existing practices; this checklist does not create new ownership assignments.
Before merge, maintainers should confirm that unresolved decisions and manual
checks remain visible, and that the proposed merge strategy produces the
intended semantic version. Passing automated checks is necessary release
evidence, but it does not by itself establish that the release is ready.

Use the [maintainer decision register](maintainer-decisions.md) to distinguish
pending release dispositions from proposed follow-ups. It preserves unresolved
support, security, Tools, helper-output, and licensing questions without making
every roadmap decision an automatic release blocker. Record any approved
decision or deferral with its evidence; the register does not grant approval.

## Required Local Verification

Install the locked dependencies in a clean checkout, then run the aggregate
release verification command:

```sh
npm ci
npm run release:verify
```

`release:verify` intentionally does not install dependencies. It preserves this
order and stops after the first failed command:

- linting and unit tests;
- the repository Storybook build;
- every release fixture;
- every packed generated-consumer fixture and supported React peer version;
- a no-script package dry run;
- the packed-package smoke test; and
- the non-publishing release analysis.

### Generated Evidence For The Checked Revision

Each `release:verify` invocation initializes a fresh
`.release-evidence/report.json`. This generated directory is ignored by Git;
the report identifies the checked source rather than a future documentation
commit. Save the report before another invocation replaces it. Use the report
from the actual release candidate instead of copying current test or fixture
totals into release notes.

The internal JSON format has `schemaVersion: 1`. It records local or
`github-actions` provenance, the checked-out Git HEAD and resolved release
base, available pull-request head/merge SHAs, and tracked-tree state before
and after verification. Tracked-change and lockfile hashes distinguish a
dirty checkout from its commit. A changed or dirty source tree remains
explicit; a report bearing a HEAD SHA does not imply an unmodified checkout.
Snapshots before and after each check preserve observed source changes even
if a later check restores the initial state. Untracked files are counted
without recording their paths or contents; their presence makes the report
incomplete because their contents are not fingerprinted.
Node.js, npm, operating system, and architecture describe the environment.

Per-check records include status and elapsed duration. Jest totals are included
when structured Jest results are available. Fixture outcomes, hashes of actual
tarballs, observed browser versions, and the structured non-publishing release
prediction are retained when produced by the corresponding check. A browser
version is `unavailable` when it was not observed; it is not inferred from a
dependency version. Tarball records also identify the npm version observed
inside the pack process (`npmVersionInPackProcess`), which can differ from
the top-level npm version. Durations describe the individual run, not a
controlled performance comparison.

Statuses distinguish `passed`, `failed`, `skipped`, and `unavailable`. After a
failure, later commands are skipped rather than represented as passing. A
check marked `skipped` or `unavailable` makes the report incomplete, even when
the job's selected commands succeed. For example, a CI job can succeed while
release analysis is skipped because its pull-request condition is false.
Inspect each report's scope before combining results from different jobs.
Handled cancellation retains partial evidence and forwards the signal to
the command's own process group on POSIX systems. On Windows, signalling
reaches only the direct child process.

CI uploads separate, uniquely named `release-evidence-...` artifacts for its
jobs and matrix entries. Their reports describe the checked-out revision,
including a prospective merge revision where applicable; they are not a
repository-wide status inferred from one successful job. Raw command output
stays in the normal Actions logs or local terminal. It is not embedded in the
JSON report. For local investigation, redirect console output to a separate
location outside `.release-evidence/` if it needs to be retained.
Open the matching Actions run's **Artifacts** section to download its reports;
check their source SHA and run attempt before using them. If writing evidence
fails, any report already on disk is stale and must not be used for that
attempt. Restore write access and rerun the intended checks.

The report is evidence of execution, not approval, risk acceptance, or
publication authorization. Dependency security audits, the optional PHP
parity check, and the authenticated semantic-release dry run remain separate
checks with their own evidence. The
[maintainer decision register](maintainer-decisions.md) and
[release review](release-review.md) retain their independent purpose.

CI runs the corresponding checks, although it keeps the expensive fixture and
packed-package work in parallel jobs for faster feedback. After a merge, the
publish workflow repeats the aggregate `release:verify` command against the
exact pushed `main` SHA before making publishing credentials available to its
separate release job. The authenticated semantic-release dry run and real
publish are never pull-request checks.

## Required CI Checks

Branch protection on both `develop` and `main` requires the following 19 check
contexts, verified against the successful [CI run 32583016604](https://github.com/emulsify-ds/emulsify-core/actions/runs/32583016604)
and the branch-protection API readback:

- `release-readiness (24.13.0)`
- `release-readiness (24.18.0)`
- `Packed package`
- `Fixture / drupal-sdc-src-components`
- `Fixture / no-platform-src-components`
- `Fixture / drupal-sdc-non-self-contained-output`
- `Fixture / non-self-contained-src-assets`
- `Fixture / non-self-contained-custom-asset-root`
- `Fixture / asset-rebase-disabled`
- `Fixture / wordpress-src-components`
- `Fixture / legacy-components`
- `Fixture / structure-implementations`
- `Fixture / mixed-storybook`
- `Fixture / large-twig-storybook`
- `Packed consumer / whisk-drupal`
- `Packed consumer / none`
- `Packed consumer / wordpress-twig`
- `React peer / 18`
- `React peer / 19`

Both branches require the pull-request branch to be up to date before merging
(`strict: true`). A failed or pending required check blocks an ordinary merge;
passing checks satisfy this gate alongside the existing review and access
requirements. Both branches still require one approving review and dismiss
stale approvals after new commits.

Administrators intentionally retain their bypass: `enforce_admins` is `false`
on both branches. Registering these check contexts preserves every other
existing protection setting, and the repository ruleset remains disabled.
These protection settings are managed through GitHub, separately from the
workflow and documentation commits.

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
for a push to `main`; merging to `main` is the explicit publication
authorization. No protected GitHub environment or new maintainer ownership
rule is assumed.

### Release Fixtures

The release fixture suite validates the 4.x checklist items that are easy to
automate. Its asset cases treat `/assets/...` and `@assets/...` as equivalent
first-class Sass/CSS aliases while separately exercising repairs for legacy
bare and wrong-depth forms:

- `drupal-sdc-src-components` builds Drupal SDC component sources and verifies mirrored root `components/` output while rejecting stale `dist/components/` component files.
- `no-platform-src-components` verifies `none` platform output stays in `dist/` and rejects Drupal globals such as `window.Drupal`, `Drupal.behaviors`, and `attachBehaviors` in emitted JavaScript.
- `drupal-sdc-non-self-contained-output` verifies that
  `assets.selfContainedOutput: false` removes project-asset copies and keeps
  query, fragment, and spaced CSS URLs pointed at the source asset tree.
- `non-self-contained-src-assets` verifies that a URL Vite resolves directly
  from `src/assets/` is rewritten to the source tree before its output copy is
  removed.
- `non-self-contained-custom-asset-root` applies the same invariant to a
  project-defined `assets.roots` directory.
- `asset-rebase-disabled` verifies that `assets.rebase: false` keeps Vite's
  emitted asset copies and leaves repairable CSS URLs unchanged.
- `wordpress-src-components` verifies the WordPress adapter keeps global assets
  under `dist/global`, component output under `dist/components`, avoids root
  `components/` mirroring, rejects Drupal globals in emitted JavaScript, and
  emits self-contained asset copies with repaired CSS URL depth.
- `legacy-components` verifies that projects using the legacy `components/`
  source layout continue to build into `dist/components/`, including
  self-contained asset copies and repaired bare and wrong-depth CSS URLs.
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

When run through the evidence collector, the existing prediction is also
recorded with resolved base and head commits. This does not rerun analysis or
change its normal CLI output or exit status. The report omits raw commit
messages and the prospective squash title. Its package-version check reads
the checked-out `package.json`; use the report's source and tracked-tree
metadata when assessing that result.

The develop-version workflow uses that same complete unreleased range after
each push to `develop`. It calculates the prospective version from the latest
stable release tag reachable on `main`, not from the version already present in
`package.json`. As a result, a feature and any later fixes remain one minor
release instead of accumulating an additional patch bump. When package
metadata already matches the prediction, the workflow leaves both package
files unchanged and does not open or update its version-bump pull request.

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

## Validated Main Publication

The publish workflow lives at `.github/workflows/publish.yml` and is triggered
only by a push to `main`. Its first job checks out the event's exact
`github.sha`, installs from the lockfile, and runs the complete
`release:verify` suite. A failed or cancelled validation prevents the release
job from starting.

Only the dependent release job receives write and trusted-publishing
permissions. It checks out the same SHA, confirms that `origin/main` still
points to that validated commit, and runs authenticated semantic-release with
`--dry-run`. Dry-run mode calculates and verifies the release without
publishing to npm, pushing a tag, or creating a GitHub release. The workflow
checks `origin/main` again immediately after dry-run and refuses real
publication if a newer commit has landed.

Publish runs share one concurrency group with `cancel-in-progress: true`, so a
new push to `main` supersedes an older validation or release run. Together with
the explicit SHA checks, this prevents a completed out-of-order or stale run
from publishing an older commit.

The validation job has only `contents: read` permission and receives no npm or
GitHub publishing credentials. The release job grants `id-token: write` for npm
trusted publishing, provides `GITHUB_TOKEN` so semantic-release can push tags
and create GitHub releases, and provides `NPM_TOKEN` as the fallback
token-based npm authentication path. `package.json#publishConfig.provenance`
requires npm to attach provenance regardless of which authentication path is
available, so publication fails instead of silently falling back to an
unattested package.

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

### Publication Recovery

If main validation fails, fix the failure on `develop` and merge the correction
to `main`; the new main SHA receives a fresh validation and publish run. If a
run is cancelled because a newer main commit landed, allow the newer run to
continue instead of rerunning the stale one.

For a transient Actions, registry, or network failure, a maintainer may rerun
the failed publish workflow only while its SHA is still the current
`origin/main`. The release job's SHA guards stop that rerun if main has advanced.
Before rerunning a failure after the real publish step began, check npm, the Git
tag, and the GitHub release first; semantic-release is designed to resume from
published release state, but maintainers should verify which side effects
already completed. After a successful publish, also confirm that npm displays
the provenance badge for the new version.
