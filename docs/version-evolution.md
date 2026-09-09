# Version Evolution

Emulsify Core has always focused on one job: package the build, Storybook, linting, and component-library conventions that Emulsify projects need, while still giving individual projects room to extend those conventions.

The implementation has moved from Webpack-centered tooling to Vite and
React/Vite Storybook while preserving that goal. Individual release notes,
including [4.3.0](releases/4.3.0.md), document minor-release scope and
compatibility changes.

## 1.x: Shared Tooling Foundation

The first major version established Emulsify Core as a reusable package instead of a set of copied project files. It bundled Storybook, Webpack, linting, a11y checks, Sass processing, Twig-related build support, asset handling, and project override hooks.

That release made it practical for themes and standalone projects to consume shared Emulsify tooling from npm while still keeping project-specific configuration in the consuming project.

## 2.x: Project Structure And Drupal SDC Support

The second major version expanded how Emulsify Core handled project structure. It added better support for older component layouts, multi-level component directories, global and foundational asset processing, Storybook static directories, and Drupal-oriented SDC workflows.

This version also continued dependency and Storybook upgrades while making more behavior configurable through project-level files. The important compatibility lesson from this era remains true: projects should not have to move working component directories just to keep using Emulsify Core.

## 3.x: Runtime Modernization

The third major version moved the package into a more modern JavaScript runtime
model. It adopted ESM, and its published `engines.node` contract required
Node.js 24 or later without a patch-specific floor. It also kept dependencies
current, refined PostCSS and Sass handling, improved component asset copying,
and continued to preserve existing Drupal SDC behavior.

It also set up the architectural runway for the current build model by cleaning up module scope, Storybook behavior, asset resolution, and package compatibility work.

## 4.x: Vite, React/Vite Storybook, And Platform Adapters

The fourth major version replaced Webpack with Vite as the build engine and
moved Storybook to the React/Vite framework. Twig templates render through
Emulsify's Storybook helper, React components use normal Storybook React
patterns, and a focused adapter renders autonomous custom elements with
documented property, attribute, default-slot, and native event boundaries.

Core 4.0 through 4.2 retained the public Node.js 24-or-later contract without a
patch-specific floor. Core 4.3.0 raised the consumer floor to Node.js 24.13.0
because of its published dependency set. This minor-release change is documented
in the [4.3.0 release notes](releases/4.3.0.md); it does not alter the
historical 3.x or earlier 4.x contracts.

The project model is also more explicit. `project.emulsify.json` drives platform and structure configuration. The normalized structure model supports `src/components`, root `./components`, and custom `variant.structureImplementations`. Platform adapters own platform-specific behavior such as Drupal behavior attachment, Drupal Twig filters, and Drupal SDC output mirroring. WordPress projects have an explicit neutral adapter that keeps Core focused on Twig authoring, Storybook, Vite, and `dist/` output while leaving WordPress runtime integration to `emulsify-wordpress-theme`.

That combination keeps existing Drupal and Twig-heavy projects viable while
making Emulsify Core a better fit for standalone Twig libraries, standalone
React libraries, custom element stories, and mixed design systems. It is not a
break from the project history; it is the same shared-tooling idea updated for
the way modern component libraries are built.

## Compatibility And Support Policy

### Current Consumer Requirements

These are the current package and tested behavior contracts. They describe
compatibility, not how long a release line receives maintenance.

| Area          | Current contract                                                                                                                           | Source                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Node.js       | `>=24.13.0` for the current package; repository development recommends 24.18.0.                                                            | [`package.json`](../package.json), [`.nvmrc`](../.nvmrc), [runtime guide](../README.md#nodejs-runtime-policy) |
| React peers   | React and React DOM `^18.0.0` or `^19.0.0`.                                                                                                | [`package.json`](../package.json), [consumer matrix](dependency-contract.md#react-peer-matrix)                |
| Installation  | Generated themes using Core as their only tooling dependency assume npm's flat `node_modules` layout.                                      | [Dependency contract](dependency-contract.md#installer-assumption)                                            |
| Build output  | Paths depend on the configured structure and platform, including opt-in Drupal SDC mirroring.                                              | [Output matrix](project-structure.md#output-path-matrix)                                                      |
| Twig helpers  | Current Core serialization and the documented portable subset; the pinned PHP revision is evidence, not a supported Tools version pairing. | [Native helpers](native-twig-extensions.md), [parity corpus](twig-php-parity.md)                              |
| Project audit | Versioned JSON with the documented finding fields, severities, and opt-in failure thresholds.                                              | [Audit contract](audit.md)                                                                                    |

### Maintenance And Security Reporting

No maintenance window, backport entitlement, response-time commitment, or
end-of-life date is established here for any release line. The existing
compatibility rule below does not promise that a release line will receive
future releases. Pending support decisions are recorded in the
[maintainer decision register](maintainer-decisions.md#maintenance-commitments-and-backports).

As checked September 9, 2026, no designated confidential Core reporting channel
was verified in the repository or inherited security guidance. Public issue
links are for ordinary bugs and feature requests; do not post vulnerability
details there. The [reporting-status record](maintainer-decisions.md#security-reporting-for-older-lines)
identifies the gap and next action, separately from older-line fix eligibility.

### Compatibility Within 4.x

The existing 4.x compatibility rule, recorded in
[`71426a8`](https://github.com/emulsify-ds/emulsify-core/commit/71426a81acf26986a30d502a2d52cd4bf550e32b),
governs changes when another 4.x release is made:

Subsequent 4.x releases preserve the current public Node.js floor of
`>=24.13.0`, React and React DOM peer floors of `^18.0.0 || ^19.0.0`, and all
other published peer dependency floors. They also preserve:

- `dist/` output paths.
- Generated BEM class names, including current serialization behavior.
- SVG sprite fragment IDs.
- Availability of the packaged scripts called by copied theme wrappers.
- Existing configuration defaults.

Raising a runtime or peer dependency floor, removing a supported peer major,
changing these output contracts, removing a script entry point, or requiring a
configuration migration requires a major release. New behavior may ship in a
minor when it is optional and existing consumers retain their current behavior.
Any intentional incompatibility must include a before/after migration note
that identifies the affected consumers and the required action.

### Historical Exceptions And Upgrade Checklist

The Node.js floor increase in 4.3.0, from `>=24` to `>=24.13.0`, was a
documented compatibility exception inside a minor release. It is not compliant
with the policy above and is not precedent for another floor increase in 4.x.
The [4.3.0 release notes](releases/4.3.0.md) remain the historical record.

[`config/release-analysis.cjs`](../config/release-analysis.cjs) also retains
explicit historical commit classifications. It treats the replacement of
Storybook HTML with Storybook React as the 4.x major trigger despite its missing
breaking-change footer. Three reporter corrections authored as `feat` are
classified as patches for 4.3.1. A fourth commit, adding detailed mode and
summary headings, is explicitly acknowledged as a capability addition but
included in that same corrective release. The file states that this exception
ends with that commit: further reporter capabilities take a minor. These
specific rules remain history, not permission for a mandatory migration in
4.5.0.

For a consumer upgrading from 4.2 to 4.5:

- **Does 4.2 → 4.5 require a runtime change?** A 4.2 consumer on Node.js 24.0.0
  through 24.12.x must move to at least 24.13.0 because of the existing 4.3.0
  exception. A consumer already on 24.13.0 or later needs no runtime change;
  4.5.0 must not raise that floor again.
- **Does 4.2 → 4.5 require a copied-script change?** Core 4.5.0 introduces no
  mandatory copied-script replacement or theme regeneration. Existing themes
  whose copied audit wrapper appends a footer to stdout need the documented
  [`>&2` correction](migration-4x.md#manual-packagejson-updates)
  when using JSON output. That repairs an existing wrapper defect; upgrading
  the npm package cannot edit a copied script.
