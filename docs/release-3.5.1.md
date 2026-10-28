# @emulsify/core 3.5.1 maintenance release

Prepared from `v3.5.0` on the `3.x` maintenance branch.
The source tag's `package.json` says `3.4.1`; the published baseline is
`@emulsify/core@3.5.0`, not the stale checked-in version.

## Release notes

### Fixed

- Raise the minimum Jest and jsdom environment versions so updating Core also
  upgrades the resolver installation code. Existing consumers can no longer
  satisfy Core's Jest requirements with the failing Jest 30.3.0 dependency chain.
- Use the resolver's supported JavaScript postinstall entry point, which works
  when the `napi-postinstall` command cannot be executed directly.

### Maintenance

- Refresh dependencies to supported stable releases compatible with the 3.x
  Webpack integration. See the [dependency review](dependency-review-3.5.1.md) for individual versions,
  migrations, and exceptions.
- Replace the old image optimizer executable downloads with prebuilt
  `@napi-rs/image` codecs through ImageMinimizerPlugin's supported custom
  implementation API. PNG optimization remains lossless and retains metadata;
  JPEG optimization copies coefficients losslessly and writes progressive JPEG.
  Image filenames and formats are retained. See the
  [upstream optimizer API](https://image.napi.rs/docs/api) and
  [custom minimizer contract](https://github.com/webpack/image-minimizer-webpack-plugin#single-minimizer-example-for-user-defined-implementation).
- Keep the published Node.js requirement of `>=24` and the existing consumer
  configuration paths, commands, and Webpack output contracts.

### Validation and known limitations

Local macOS and Linux ARM64 validation includes lifecycle-enabled installation,
tests, lint, fresh and historical-lock consumer upgrades, `npm ci`, production
Webpack, static Storybook, and the non-executable-helper regression. macOS
consumer checks also pass on Node 24.0.2. See the
[validation record](maintenance-3.5.1/README.md).

This release does not clear the security audit: the repository has 33 affected
packages, including 3 critical, with upstream constraints documented in the
[audit and deprecation report](audit-deprecations-3.5.1.md). The report also
distinguishes fresh consumer findings from dependencies retained by older
consumer lockfiles.

## Consumer upgrade

After 3.5.1 has been published, run these commands in the project or theme that
depends on Core, using Node.js 24 or newer:

```sh
npm install @emulsify/core@^3.5.1
npm ls @emulsify/core jest @jest/core jest-resolve unrs-resolver napi-postinstall
npm ci
```

Use `npm install --save-dev @emulsify/core@^3.5.1` instead if Core is already a
development dependency. Commit the updated `package.json` and `package-lock.json`
together. The existing lockfile is updated by `npm install`; deleting it is not
required. Core's new direct minimums enforce the fixed resolver chain without
project-specific overrides or permission repair commands.

For the maintained 3.x distribution channel, an equivalent upgrade command is:

```sh
npm install @emulsify/core@legacy-3
```

An unqualified `npm install @emulsify/core` follows the newer release line.

## Publishing channel and review checks

Intended release: **3.5.1**, from **3.x**, npm distribution tag **legacy-3**.
The newer release line retains npm's **latest** tag. Both the maintenance branch
configuration and `publishConfig.tag` explicitly choose `legacy-3`.
This uses semantic-release's documented
[maintenance branch and channel configuration](https://semantic-release.org/foundation/workflow-configuration/).

```sh
node scripts/verify-maintenance-release.cjs
```

This read-only check calls the supported commit-analyzer plugin, verifies a patch
increment from `v3.5.0` to `3.5.1`, and checks the maintenance range and npm tag.
While the changes remain uncommitted it analyzes the prospective conventional
commit `fix(deps): refresh 3.x dependencies and repair resolver installation`.
Once committed it analyzes the actual commits after `v3.5.0` instead. The final
merge or squash commit must retain a `fix` subject so semantic-release calculates
a patch rather than a minor release.

The check invokes no publish lifecycle, creates no commits or tags, and does not
contact a writable remote. A full remote semantic-release dry run remains a
release-stage check after review and branch creation on the remote: even
[dry-run checks remote push permissions](https://semantic-release.org/usage/configuration/#dryrun)
and cannot validate an unpushed maintenance branch as if it were published.
No publishing, tagging, pushing, or committing was performed during preparation.

The maintenance workflow runs the checks on macOS and Linux with Node.js 24;
the publishing workflow waits for that matrix on `3.x`. Configuring this workflow
does not constitute a completed CI run. See the validation evidence for the
checks completed locally and those still awaiting CI.

The maintenance publisher uses `.github/workflows/publish.yml`, matching the
existing newer release line's npm trusted-publisher filename, with OIDC enabled.
It runs a full semantic-release dry run before publishing and verifies that the
validated commit is still the maintenance branch head. No release scripts from
the newer architecture are required.
