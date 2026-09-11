# Reproducing the September 9 dependency assessment

The [decision record](../../security-4.5.0.md) explains exposure and the
unresolved maintainer decisions. [assessment.json](assessment.json) records
the source revision, lockfile digests, package integrity, installed versions,
audit exit codes, and install/test output. The adjacent audit JSON files are
unfiltered npm reports. The selected `*-tree.json` files preserve dependency
paths; [primary-sources.json](primary-sources.json) records current registry
versions, declared ranges, and advisory identities/timestamps.

The tested source baseline was `6a74618eccbae9487f47674b405339d1eda851cf`.
The only implementation change is the repository lockfile's `colord` entry,
2.9.3 to 2.10.0. The patched lockfile digest identifies the exact tested change.
No manifest version, public dependency range, or override changed.

## Versions and isolated installations

Use Node **24.19.0** and npm **11.17.0** to reproduce these installations.
Select them for both npm and lifecycle scripts, and check `node --version`
and `npm --version` in the same shell that runs the install. The original
network-enabled shell selected a different system Node; all reported results
were repeated with Node 24's `bin` directory first on `PATH`.

Run the following from a checkout containing this assessment. Use a new
temporary directory; none of these commands replaces the working checkout's
`node_modules`. Choose an existing browser maintained by your organization
only when testing the optional managed-browser configuration.

```sh
security_repo="$PWD"
security_dir="$(mktemp -d)"
mkdir "$security_dir/core" "$security_dir/consumer" "$security_dir/artifacts"
mkdir "$security_dir/browser-cache"
git archive HEAD | tar -x -C "$security_dir/core"

export npm_config_cache="$security_dir/npm-cache"
export PUPPETEER_SKIP_DOWNLOAD=true
export PUPPETEER_CACHE_DIR="$security_dir/browser-cache"

cd "$security_dir/core"
npm ci --foreground-scripts --no-audit --no-fund
npm audit --json > "$security_dir/artifacts/core-audit.json"
npm audit --omit=dev --json > "$security_dir/artifacts/core-audit-omit-dev.json"
```

Both audit commands exited **1** in this assessment. Keep their reports and
statuses; do not convert them to passing checks. `--no-audit` on installation
only separates the install log from the explicit security queries above.
Install lifecycle scripts still run. In an archived source tree, Core's
prepare script runs the Node check and Husky reports that `.git` is absent.

To reproduce the pre-remediation baseline, archive the baseline SHA above into
a separate empty directory and repeat `npm ci` and both audit commands.
The targeted remediation was resolved with:

```sh
npm update colord --package-lock-only --ignore-scripts --no-audit --no-fund
```

Only the resulting `colord` entry was retained; npm's incidental refresh of a
bundled `picomatch` peer flag was left out. The final lockfile was validated
with another clean `npm ci`. No `npm audit fix --force` or major override was
used.

## Pack and replay the consumer

```sh
cd "$security_dir/core"
npm pack --ignore-scripts --json --pack-destination "$security_dir/artifacts"
cp -R .github/fixtures/release/drupal-sdc-src-components/. "$security_dir/consumer/"
cp -R .github/fixtures/consumer/whisk-drupal/. "$security_dir/consumer/"
cp "$security_repo/docs/security/4.5.0/consumer-package.json" "$security_dir/consumer/package.json"
cp "$security_repo/docs/security/4.5.0/consumer-package-lock.json" "$security_dir/consumer/package-lock.json"

cd "$security_dir/consumer"
npm ci --foreground-scripts --no-audit --no-fund
npm audit --json > "$security_dir/artifacts/consumer-audit.json"
npm audit --omit=dev --json > "$security_dir/artifacts/consumer-audit-omit-dev.json"
npm ls pa11y puppeteer puppeteer-core @puppeteer/browsers extract-zip colord stylelint js-yaml axe-core npm --all --json
```

The archived consumer manifest uses `file:../artifacts/emulsify-core-4.5.0.tgz`
and the fixture's existing root overrides. The consumer lockfile records the
fresh compatible resolution observed on September 9. To assess **today's fresh
resolution** instead, omit copying that lockfile, run
`npm install --package-lock-only --ignore-scripts --no-audit --no-fund`, then
`npm ci`. Record the new lockfile, installed versions, and audit output; registry
results may differ. Both consumer security audits exited **1** here.

The tarball's SHA-256 was
`9abb3382224b78e114a2c0c209255ab5d8f31e9d999943d1bfff7d3ea8e8e153`.
Packing before and after the Core lockfile patch produced identical npm
integrity values. Core's lockfile is not in the tarball. Replaying this saved
consumer lockfile requires that same package content; later source changes
will intentionally produce a different integrity value.

## Verify the optional managed-browser path

With the variables above, the real Puppeteer postinstall printed
`Skipping downloading browsers as instructed.` The browser cache stayed empty
through installation and scanning. npm still downloads and extracts npm
package tarballs; this setting addresses Puppeteer's separate browser artifacts.

A benign [network guard](deny-installer-network.mjs) also verified the installed
Puppeteer early-return path. It denies and counts HTTP/HTTPS/fetch calls; its
self-test throws before any network operation. It is not a general network
sandbox and does not exercise an archive exploit.

```sh
cd "$security_dir/consumer"
MANAGED_BROWSER_GUARD_TRACE="$security_dir/artifacts/guard-selftest.jsonl" \
  MANAGED_BROWSER_GUARD_SELFTEST=1 \
  node --import "$security_repo/docs/security/4.5.0/deny-installer-network.mjs" \
  --input-type=module -e ''

MANAGED_BROWSER_GUARD_TRACE="$security_dir/artifacts/guard-installer.jsonl" \
  node --import "$security_repo/docs/security/4.5.0/deny-installer-network.mjs" \
  node_modules/puppeteer/install.mjs
```

The recorded self-test has one blocked call; the actual installer has zero,
exits 0, and prints the skip message. The installed skip branch returns before
download/install/extraction. See [managed-installer-proof.json](managed-installer-proof.json).

For the existing packed fixture, set the path to your managed browser and run:

```sh
export PUPPETEER_EXECUTABLE_PATH=/absolute/path/to/managed/chromium
npm run lint-js
npm run lint-styles
npm run test
npm run a11y
npm run a11y-wcag22
npm run --silent audit -- --json
```

All commands passed their expected outcomes. The fixture's Jest command found
no tests and used its existing `--passWithNoTests`; this validates command
wiring, not additional unit coverage. The ordinary accessibility run scanned
one story with a clean report. WCAG fixture cases exited `0/1/0/0`, including
the deliberately failing small-target case. The copied component-audit wrapper
preserved full JSON stdout, its stderr footer, and default 0 / fail-on-warn 1.
The normal component audit reported one migration warning and two CSS URL
information findings; it is not a clean npm security report.

A separate check set `pa11y.chromeLaunchConfig.executablePath` in the project
configuration with `PUPPETEER_EXECUTABLE_PATH` unset. The trace verified the
actual spawn file, browser version, clean report, and disconnect. The configuration,
trace source, command results, and output are in [managed-browser.json](managed-browser.json)
and [managed-config-proof.json](managed-config-proof.json).

The proof used the existing `/opt/homebrew/bin/chromium`, version
`124.0.6355.0`. This demonstrates configuration compatibility, not that this
old browser version is currently secure or recommended. Maintainers must select
and maintain an appropriate patched browser and review its provisioning.
No external browser is made mandatory for Core consumers.

## Affected checks

Against the clean patched Core installation:

```sh
node_modules/.bin/jest --config config/jest.config.js --runInBand --coverage=false \
  scripts/a11y.test.js scripts/a11y-outcomes.test.js scripts/a11y-cli.test.js \
  config/a11y-wcag22.test.js
npm run lint
```

Forty tests, four suites, and three snapshots passed. A benign Stylelint check
explicitly enabled `color-named: always-where-possible`: the expected hex-to-name
finding remained identical after the `colord` update, and a valid named color
remained clean. The [before](colord-lint-before.json) and
[after](colord-lint-after.json) outputs preserve that distinction.

Temporary machine paths are normalized in evidence JSON. Audit identifiers,
package versions, integrity values, findings, and command statuses are retained.
These technical checks neither assign an owner nor accept residual risk or
authorize publication.
