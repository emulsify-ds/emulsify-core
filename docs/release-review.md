# Release Pull Request Review

Use this checklist for a release branch merging into `main`, or for another
pull request that combines several independent areas of release risk. It
complements the automated checks in [Release Verification](release.md); passing
automation is evidence for review, not a substitute for reviewing behavior,
compatibility, and release scope.

This checklist does not assign ownership. Maintainers should arrange review
coverage according to the repository's existing practices and record that
coverage in the pull request. Each track must either have supporting evidence
or be marked not applicable with a short reason. Keep incomplete manual checks
and unresolved decisions visible in the pull request body.

## Required Pull Request Description

A release pull request must include distinct sections for:

- a summary and the intended release outcome;
- user-facing additions;
- compatibility and migration impact;
- internal architecture and performance changes;
- public API and package-export changes, including an explicit statement when
  there are none;
- known limitations;
- release evidence, with the exact commands and CI checks completed;
- checks or decisions that remain outstanding; and
- linked originating issues or feature pull requests. If no originating issue
  exists, explain briefly how and why the work entered the release instead of
  writing only "None."

State the proposed semantic version and the Node.js support policy explicitly.
Separate public behavior from internal refactoring, and distinguish checks that
were run locally from checks observed in CI. Do not describe the release as
ready solely because automated checks passed.

## Review Record

The release pull request can copy this table to make coverage and unresolved
work visible without assigning permanent owners:

| Review Track                               | Evidence Or Review Link | Status Or Outstanding Work |
| ------------------------------------------ | ----------------------- | -------------------------- |
| Storybook API and custom elements          |                         |                            |
| Twig and Vite runtime                      |                         |                            |
| Audit CLI and JSON contract                |                         |                            |
| Package exports and tarball                |                         |                            |
| Generated-consumer dependency contract     |                         |                            |
| Node.js and dependency compatibility       |                         |                            |
| Accessibility                              |                         |                            |
| Documentation and migration guidance       |                         |                            |
| Release automation and semantic versioning |                         |                            |

Use `Reviewed`, `Not applicable — <reason>`, or
`Outstanding — <next action>` in the status column. A passing automated check
can support a track, but it is not itself a `Reviewed` status.

## Public Storybook API And Custom Elements

- [ ] **User-visible behavior:** Verify the documented public imports and
      authoring flow in a built Storybook, including supported property,
      attribute, registration, wrapper, slot, event, and shadow-DOM behavior.
- [ ] **Backward compatibility:** Confirm existing Twig and React stories are
      unchanged and repeated evaluation, remounting, and HMR-like registration
      behave predictably.
- [ ] **Tests and fixtures:** Review the focused unit tests, browser-level
      controls test, mixed Storybook fixture, and packed-consumer coverage that
      exercise the public API.
- [ ] **Documentation:** Confirm examples use the exported names and accurately
      distinguish custom-element registration from broader web component
      authoring.
- [ ] **Known limitations:** Ensure unsupported slots, events, shadow roots,
      reserved properties, or other boundaries are explicit and reflected in
      tests.
- [ ] **Semantic version:** Decide whether additions, removals, or changed
      runtime behavior fit the proposed release type.

## Twig And Vite Compilation, Discovery, Caching, And HMR

- [ ] **User-visible behavior:** Exercise Twig compilation, dependency
      discovery, cache invalidation, HMR, and asset-source resolution through
      the affected project and platform configurations.
- [ ] **Backward compatibility:** Confirm supported source layouts, Twig
      helpers, platform adapters, output paths, and extension points continue
      to work.
- [ ] **Tests and fixtures:** Review focused unit coverage and the relevant
      Drupal, WordPress, `none`, legacy-layout, structure, scale, and Storybook
      fixtures.
- [ ] **Documentation:** Confirm current configuration, asset, performance, and
      extension-point behavior is documented in the appropriate evergreen
      guides.
- [ ] **Known limitations:** Record unresolved dependency-discovery, caching,
      HMR, platform, or asset-resolution boundaries.
- [ ] **Semantic version:** Decide whether compilation or output changes are
      compatible with the proposed release type.

## Audit CLI And JSON Compatibility

- [ ] **User-visible behavior:** Run human and JSON modes and verify output
      streams, scan metadata, normalized paths, findings, failure thresholds,
      and exit codes.
- [ ] **Backward compatibility:** Check compatibility aliases, stable finding
      identifiers, optional fields, schema-version rules, and separation of
      report schema and tool versions.
- [ ] **Tests and fixtures:** Review empty and populated reports, every
      severity threshold, malformed arguments, setup failures, path
      normalization, snapshots, and packaged CLI execution.
- [ ] **Documentation:** Confirm the complete JSON example, stable-field
      policy, `jq` examples, and CI usage match the implementation.
- [ ] **Known limitations:** State which fields, finding IDs, inputs, or output
      modes are not guaranteed beyond the documented contract.
- [ ] **Semantic version:** Decide whether CLI defaults or machine-readable
      contract changes fit the proposed release type and schema version.

## Package Exports And Tarball Contents

- [ ] **User-visible behavior:** Import every intended entry point from native
      Node.js ESM in a clean project that installed the packed tarball, and run
      packaged executables where applicable.
- [ ] **Backward compatibility:** Compare the export map with the previous
      release, identify every added or removed public path, and confirm internal
      modules do not become accidental supported APIs.
- [ ] **Tests and fixtures:** Review export-target existence, package-content
      exclusions, required runtime imports, package dry-run assertions, and the
      packed-package smoke test.
- [ ] **Documentation:** List every new public export and describe its intended
      stability; do not document internal implementation paths as consumer
      APIs.
- [ ] **Known limitations:** Record supported module systems, installation
      assumptions, or intentionally inaccessible internals.
- [ ] **Semantic version:** Decide whether any export removal, rename, or
      behavior change requires a different release type.

## Generated-Consumer Dependency Compatibility

- [ ] **User-visible behavior:** Install the packed package in representative
      generated projects and run the consumer scripts that depend on Core's
      Vite, Storybook, lint, test, and accessibility tooling.
- [ ] **Backward compatibility:** Confirm supported consumer shapes, React peer
      ranges, hoisted dependency behavior, and the documented package-manager
      boundary remain accurate.
- [ ] **Tests and fixtures:** Map every script in the consumer contract to an
      executable fixture, verify required dependencies remain published, and
      inspect failure output for missing dependencies.
- [ ] **Documentation:** Confirm each fixture's real consumer model, React
      matrix, npm layout boundary, and snapshot-update process are documented.
- [ ] **Known limitations:** Keep unsupported linking models and consumer
      configurations explicit rather than implying untested support.
- [ ] **Semantic version:** Decide whether dependency or peer-range changes fit
      the proposed release type for generated consumers.

## Node.js And Dependency Compatibility

- [ ] **User-visible behavior:** Verify consumers can run at the public Node.js
      floor while repository development and CI use the documented exact
      version.
- [ ] **Backward compatibility:** Identify concrete engine constraints and
      meaningful dependency upgrades, and preserve the historically published
      requirements for older releases.
- [ ] **Tests and fixtures:** Review version-parser boundaries, useful failure
      messages, clean installation, lockfile consistency, and the release
      fixtures that exercise upgraded dependencies.
- [ ] **Documentation:** Confirm `package.json`, `.nvmrc`, CI, current guides,
      migration guidance, release notes, and version history distinguish the
      same support and development policies.
- [ ] **Known limitations:** Record unsupported Node.js versions and any
      dependency-specific runtime or platform constraints.
- [ ] **Semantic version:** Decide whether the runtime floor or dependency
      compatibility impact is appropriate for the proposed release type.

## Accessibility

- [ ] **User-visible behavior:** Check the affected authoring models with
      keyboard, focus, role, name, state, and announcement behavior appropriate
      to the feature.
- [ ] **Backward compatibility:** Confirm the release does not regress existing
      accessible output or imply broader accessibility coverage than it
      provides.
- [ ] **Tests and fixtures:** Review automated accessibility assertions and
      browser tests, plus any manual checks needed for behavior automation
      cannot prove.
- [ ] **Documentation:** Ensure light-DOM and shadow-DOM coverage, addon
      behavior, author responsibilities, and test boundaries are stated
      accurately.
- [ ] **Known limitations:** Keep untested assistive-technology, closed-shadow,
      slot, focus-management, or platform cases visible.
- [ ] **Semantic version:** Decide whether accessibility behavior changes alter
      a public contract or require a different release type.

## Documentation And Migration Guidance

- [ ] **User-visible behavior:** Run documented commands and verify examples,
      option names, version numbers, links, and expected outputs against the
      release implementation.
- [ ] **Backward compatibility:** Preserve historical facts and distinguish
      evergreen behavior, major-version migration guidance, current release
      notes, and version history.
- [ ] **Tests and fixtures:** Run Markdown formatting and link checks, plus
      package-metadata or example tests affected by documentation changes.
- [ ] **Documentation:** Confirm README, topic guides, migration documentation,
      release notes, and the documentation index agree without duplicating
      conflicting policy.
- [ ] **Known limitations:** Ensure deferred behavior and manual migration work
      remain explicit and are not presented as complete support.
- [ ] **Semantic version:** Confirm the documented migration and compatibility
      impact matches the proposed release type.

## Release Automation And Semantic-Version Calculation

- [ ] **User-visible behavior:** Verify the package tested in CI is the tarball
      users will install and that the calculated version matches the intended
      release outcome.
- [ ] **Backward compatibility:** Confirm the established merge strategy,
      conventional-commit range, package contents, publishing permissions, and
      release workflow remain safe.
- [ ] **Tests and fixtures:** Review the aggregate verification command,
      parallel CI jobs, package dry run, tarball smoke test, consumer fixtures,
      release analyzer, and trusted semantic-release dry run.
- [ ] **Documentation:** Confirm required CI checks, maintainer-only steps,
      merge-title rules, credentials, and the non-publishing boundary are
      described accurately.
- [ ] **Known limitations:** List outstanding manual approval, credentialed
      verification, registry, branch-protection, or post-merge checks.
- [ ] **Semantic version:** Verify the proposed merge commit range and any
      prospective squash title produce the intended version, including
      breaking-change footers where required.

## Before Merge

- [ ] Every track has review evidence or a not-applicable reason; outstanding
      work names its next action.
- [ ] The pull request records exact local commands and CI checks against an
      identifiable commit.
- [ ] Manual checks, accepted limitations, and unresolved decisions remain
      visible.
- [ ] The base branch and selected merge strategy match the release workflow.
- [ ] If squash merge will be used, its title is conventional and produces the
      same semantic version as the reviewed commit range.
- [ ] Maintainers have made the final release decision based on the review
      record as well as automated evidence.
