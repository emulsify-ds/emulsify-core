# 4.5.0 Dependency Security Review

Reviewed September 9, 2026. This record separates dependency remediation,
technical exposure, operational mitigation, and maintainer risk acceptance.
Passing installation or accessibility checks does not establish risk acceptance.

The evidence uses `npm audit --json` and `npm audit --omit=dev --json`.
`npm run audit` is Core's component-readiness audit and does not produce this
dependency report. Vulnerable package-entry counts include affected parents;
they are not counts of distinct advisories or CVEs.

## Current Verification

The source baseline is `6a74618eccbae9487f47674b405339d1eda851cf`, followed
by the targeted Core lockfile update described below. Final verification pins
Node.js **24.19.0** and npm **11.17.0** explicitly. Earlier exploratory runs
under Node.js 26/npm 11.19 are excluded from the comparison.

| Installation and audit scope                              | Vulnerable package entries | Distinct advisories | Evidence                                                                             |
| --------------------------------------------------------- | -------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| Clean locked Core before the `colord` update, full audit  | 6: 5 high, 1 moderate      | 3                   | [Core before](security/4.5.0/core-before-audit.json)                                 |
| Clean locked Core after the `colord` update, full audit   | 5 high                     | 2                   | [Core after](security/4.5.0/core-after-audit.json)                                   |
| Clean locked Core after the `colord` update, `--omit=dev` | 5 high                     | 2                   | [Core after, production dependencies](security/4.5.0/core-after-audit-omit-dev.json) |
| Fresh packed consumer, full audit                         | 6 high                     | 2                   | [Consumer](security/4.5.0/consumer-audit.json)                                       |
| Fresh packed consumer, `--omit=dev`                       | 6 high                     | 2                   | [Consumer, production dependencies](security/4.5.0/consumer-audit-omit-dev.json)     |

The consumer installs the actual `@emulsify/core@4.5.0` tarball, not a source
checkout or Core's lockfile. The measured tarball's npm SHA-1 is
`9a9e6f5c5bc130a944d7ac8eae8d4b8c8ad1a9f8`; its integrity and install
provenance are retained with the [verification evidence](security/4.5.0/README.md).
The consumer's extra `@emulsify/core` parent entry does not add an advisory.
Build and accessibility tooling remains in consumers' production dependency
graphs, so `--omit=dev` does not remove the residual browser chain. The clean
patched Core installation succeeds with exit code 0; all final Core and
consumer audits above exit 1 because of the residual high-severity entries.

## Compatible Remediation

### `colord`: oversized malformed color strings

[`GHSA-2wm5-q62r-hmrv`](https://github.com/advisories/GHSA-2wm5-q62r-hmrv)
(`CVE-2026-85062`, moderate) affects `colord <2.9.4`. Its prerequisite is
parsing an oversized malformed color string through the affected parser;
the impact is excessive processing time. Core reaches `colord` through
`stylelint`, so the relevant exposure is developer or CI linting of supplied
stylesheets. No direct Core source import of `colord` was found.

In the inspected Stylelint version, the relevant parser call is behind
`color-named: always-where-possible`. Core's resolved stylesheet configuration
does not enable that rule (`color-named` is null); a consumer can enable it in
its own configuration. No malicious-input test was needed to establish the
dependency path or validate the compatible patch.

The targeted Core lockfile update moves `node_modules/colord` from **2.9.3
to 2.10.0**, which satisfies Stylelint's existing `^2.9.3` range and exceeds
the fixed version, 2.9.4. Only that entry's version, resolved URL, and
integrity change. There is no package-manifest change, major-version upgrade,
or new override. The freshly resolved consumer already installs 2.10.0 and
does not report this advisory. The clean patched Core installation succeeds,
and neither final Core audit reports it. A benign Stylelint check still reports
the expected single hex-to-named-color finding; an already named `red` value
remains clean. The affected Core checks pass: 40 tests across four suites,
three snapshots, and the repository lint check. These checks establish
compatibility of the lockfile update, not absence of other vulnerabilities.
The [assessment](security/4.5.0/assessment.json) records the exact lockfile
change, test counts, and command outcomes.

For `GHSA-2wm5-q62r-hmrv`, remediation is verified for this Core lockfile and
the fresh consumer. The accountable owner and next review date remain
unresolved; no acceptance of older themes that retain an affected version
is recorded. The proposed review trigger is a Stylelint or consumer-lockfile
refresh, or a new advisory: confirm the resolved `colord` version remains
outside affected ranges. This technical fix does not accept risk on behalf
of consumers whose lockfiles have not changed. The archived audit and
lockfile evidence identify what was checked, not future registry resolutions.

### Earlier compatible updates

The September 7 record reported a reduction from 12 vulnerable package
entries to five after these compatible updates:

| Package                   | Previous locked version | Updated locked version |
| ------------------------- | ----------------------- | ---------------------- |
| `brace-expansion`         | 1.1.17 / 5.0.8          | 1.1.18 / 5.0.9         |
| `fast-uri`                | 3.1.4                   | 3.1.7                  |
| Nested `js-yaml`          | 3.15.0 / 4.3.0          | 3.15.2 / 4.3.2         |
| Release-only `npm` bundle | 11.18.0                 | 11.19.1                |

These patches addressed the recorded
[`brace-expansion`](https://github.com/advisories/GHSA-rgw5-rvv9-x895),
[`fast-uri`](https://github.com/advisories/GHSA-5jgf-p345-68v8), and
[`js-yaml`](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) ranges.
Updating npm as a unit also cleared the then-reported release-only
`ip-address`, `tar`, `undici`, and affected `npm` entries. Those historical
totals are not the September 9 verification result: the advisory database now
also reports `colord` and a second `extract-zip` advisory.

## Residual ZIP Extraction Advisories

Both remaining advisory identities affect **`extract-zip <=2.0.1`**:

- [`GHSA-jmr9-qjv8-65gv`](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)
  (`CVE-2026-56876`, high): unvalidated symlink path traversal.
- [`GHSA-7pqw-9j4j-h8q3`](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3)
  (`CVE-2026-19693`, high): arbitrary file writes through symlink archive
  entries.

These are two advisories on one affected extraction package, not five or six
independent vulnerabilities. Both installations resolve Pa11y **9.1.1**,
Puppeteer and puppeteer-core **24.43.1**, `@puppeteer/browsers` **2.13.2**,
and `extract-zip` **2.0.1**. Puppeteer and puppeteer-core both reach the same
affected browser manager. The audited dependency paths are:

| Context         | Dependency path and installed location                                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core            | `pa11y → puppeteer / puppeteer-core → @puppeteer/browsers → extract-zip`. Puppeteer and its browser manager are nested under `node_modules/pa11y/node_modules/`; `extract-zip` is at `node_modules/extract-zip`. |
| Packed consumer | `@emulsify/core → pa11y → puppeteer / puppeteer-core → @puppeteer/browsers → extract-zip`. The fresh tree hoists these packages to the consumer's `node_modules/`.                                               |

The locked Core and freshly resolved consumer differ outside this shared
chain. The [installed-version evidence](security/4.5.0/assessment.json) verifies
these resolutions; they are not a promise of future resolution:

| Package                                   | Patched locked Core | Fresh packed consumer |
| ----------------------------------------- | ------------------- | --------------------- |
| `stylelint`                               | 17.14.1             | 17.15.0               |
| Root `js-yaml`                            | 5.3.0               | 5.4.1                 |
| `colord`                                  | 2.10.0              | 2.10.0                |
| Pa11y's nested `axe-core`                 | 4.11.4              | 4.11.4                |
| Root `axe-core`                           | 4.13.0              | 4.13.0                |
| Additional dev-only `puppeteer`           | 25.7.0              | Absent                |
| Additional dev-only `@puppeteer/browsers` | 3.2.0               | Absent                |
| Release-only `npm` bundle                 | 11.19.1             | Absent                |

The additional Core dev-only browser packages do not replace Pa11y's nested
affected chain. The release-only npm bundle is also distinct from npm 11.17.0
used to run these installs and audits.

### Exposure and prerequisites

The affected path is **browser archive installation on a developer or CI
machine**. Pa11y's Puppeteer installer downloads a browser archive, invokes
`unpackArchive()`, and its ZIP branch loads `extract-zip`. The prerequisites
differ by advisory:

- [`GHSA-jmr9-qjv8-65gv`](https://github.com/advisories/GHSA-jmr9-qjv8-65gv):
  an extracted archive symlink points outside the destination. The extraction
  does not validate its target; subsequent use of that link can permit reads
  or writes outside the destination.
- [`GHSA-7pqw-9j4j-h8q3`](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3):
  a regular-file entry is written through a symlink at its final destination
  path. The advisory describes a same-named symlink entry followed by the
  regular file. Inspection of the installed `createWriteStream(dest)` call
  also implies exposure when that final-entry symlink already exists in the
  extraction directory, since only the parent directory is containment-checked.
  The [upstream proposed fix](https://github.com/max-mapper/extract-zip/pull/160)
  addresses this final-path check.

Download sources, configured mirrors, archive caches, and extraction-directory
ownership therefore form part of the assessment. An advisory entry does not
prove that an installation encountered an unsafe archive or destination.

Scanning with an already installed browser does not itself invoke this
archive-extraction path. No exploit against a site visitor or shipped Core
component was demonstrated by this review. This distinction limits the
identified exposure; it does not remove the vulnerable package or cover every
possible use of its extraction API.

### Remediation availability and mitigation

The September 9 [registry and advisory evidence](security/4.5.0/primary-sources.json)
records these compatibility boundaries:

| Package               | Current chain constraint | Latest compatible version | Registry latest |
| --------------------- | ------------------------ | ------------------------- | --------------- |
| `pa11y`               | Core `^9.1.1`            | 9.1.1                     | 10.0.0          |
| `puppeteer`           | Pa11y `^24.37.5`         | 24.43.1                   | 25.10.0         |
| `@puppeteer/browsers` | Puppeteer pins `2.13.2`  | 2.13.2                    | 3.2.2           |
| `extract-zip`         | Browser manager `^2.0.1` | 2.0.1                     | 2.0.1           |
| `colord`              | Stylelint `^2.9.3`       | 2.10.0                    | 2.10.0          |

No patched `extract-zip` release is published. There is no compatible Pa11y 9
update that removes this chain.
Core's audit proposes **Pa11y 10.0.0**, explicitly marked a semver-major fix;
the consumer audit reports no available fix through its current Core
dependency range. These statements describe different dependency boundaries
and are not contradictory.

Pa11y 10 is a migration candidate, not a drop-in override: it changes to
Puppeteer 25 and axe-core 4.13. Browser installation prerequisites and changed
accessibility results require compatibility evaluation. This review does not
force that migration or add a Puppeteer override to silence the report.

An operational mitigation is to install with `PUPPETEER_SKIP_DOWNLOAD=true`
and configure Pa11y to use an independently provisioned, managed browser via
`pa11y.chromeLaunchConfig.executablePath`. The browser must already exist;
disabling downloads alone does not provide one. Its provisioning process,
updates, archive source, and cache still require separate review. The affected
packages remain installed and continue to appear in `npm audit`.

The [managed-browser proof](security/4.5.0/managed-browser.json) verifies this
optional technical control against the actual packed consumer. Running its
Puppeteer 24.43.1 installer with download skipping enabled exits 0, records
zero HTTP/HTTPS/fetch attempts under a temporary guard, and leaves a fresh
browser cache empty; the guard's self-test blocks one attempted request.
With `PUPPETEER_EXECUTABLE_PATH` unset, the explicit project Pa11y configuration
launches `/opt/homebrew/bin/chromium` (Chrome 124.0.6355.0), produces a clean
accessibility report, and disconnects. The four packed WCAG cases match their
expected exit codes (0/1/0/0); the intentional tiny-target failure is retained.
The packed consumer's JS/style lint, accessibility command (one clean story),
and component-audit wrapper checks also pass. Its test command exits 0 with
`--passWithNoTests`, so it contributes no executed unit tests.
This demonstrates the configured path on the tested macOS/browser combination;
it does not certify that browser version or its provisioning process. Chrome
124 is proof of configuration behavior, not a current security recommendation;
managed-browser patch maintenance remains unassessed.

Trusted download sources and caches, restricted cache ownership, and limiting
credentials in install/build jobs remain operational recommendations. This
review does not establish their adoption. The verified control is neither a
package patch nor evidence of maintainer acceptance of the residual risk.

### Ownership and acceptance

The following decision state applies separately to each advisory and both
dependency paths above:

| Advisory              | Accountable owner | Risk acceptance                 | Next review date |
| --------------------- | ----------------- | ------------------------------- | ---------------- |
| `GHSA-jmr9-qjv8-65gv` | Unresolved        | No explicit acceptance recorded | Unresolved       |
| `GHSA-7pqw-9j4j-h8q3` | Unresolved        | No explicit acceptance recorded | Unresolved       |

The [PR #314 discussion](https://github.com/emulsify-ds/emulsify-core/pull/314)
was checked on September 9: its body was the unfilled template, with no
comments or reviews recording ownership or acceptance. Passing checks,
authoring the release, or maintaining a package does not assign an accountable
owner by inference.

The [maintainer decision register](maintainer-decisions.md#residual-browser-chain-acceptance)
holds the available options, proposed review triggers, and next action for
these unresolved decisions. This technical assessment does not establish a
security-reporting channel or a maintenance commitment for older release lines;
see the separate [reporting decision](maintainer-decisions.md#security-reporting-for-older-lines).

## Consumer Action and Reproduction

Core's repository lockfile is not installed into a consuming theme. Refresh
the theme's own lockfile within its compatible dependency ranges, then run
its dependency audit and relevant build/accessibility checks. Updating
`@emulsify/core` alone can leave vulnerable transitives pinned in an existing
consumer lockfile. Root overrides remain subject to the
[root-only boundary](migration-4x.md#install-warning-controls).

Use the [reproduction instructions and archived evidence](security/4.5.0/README.md)
for the exact runtime, install commands, tarball, audit outputs, dependency
paths, and registry facts. Full and `--omit=dev` audits must both be retained;
a passing compatibility test does not turn an advisory report into a passing
security audit. Registry results and freshly resolved compatible versions can
change after this review.
