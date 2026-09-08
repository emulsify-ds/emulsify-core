# 4.5.0 Dependency Security Review

This review uses clean locked installations and `npm audit --json`, not the
component report produced by `npm run audit`. Counts below are vulnerable
package entries, including affected parents, rather than distinct CVEs.

## Compatible Updates

The Core baseline contained 12 entries: 11 high and one moderate. After the
updates, a clean Node.js 24.13.0 install contains five high entries, all from
the Pa11y browser-download chain described below.

| Package                   | Previous locked version | Updated locked version |
| ------------------------- | ----------------------- | ---------------------- |
| `brace-expansion`         | 1.1.17 / 5.0.8          | 1.1.18 / 5.0.9         |
| `fast-uri`                | 3.1.4                   | 3.1.7                  |
| Nested `js-yaml`          | 3.15.0 / 4.3.0          | 3.15.2 / 4.3.2         |
| Release-only `npm` bundle | 11.18.0                 | 11.19.1                |

These compatible patches remove the targeted
[`brace-expansion`](https://github.com/advisories/GHSA-rgw5-rvv9-x895),
[`fast-uri`](https://github.com/advisories/GHSA-5jgf-p345-68v8), and
[`js-yaml`](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) advisory ranges.
The npm bundle must be updated as a unit to keep its bundled dependency
metadata honest; its `brace-expansion` moves from 5.0.7 to 5.0.9. That same
bundle update clears the release-only `ip-address`, `tar`, `undici`, and
affected `npm` entries. No dependency changes major, the root `js-yaml`
remains 5.3.0, and the public Node and React requirements are unchanged.

The seven entries removed from Core's report are `brace-expansion`,
`fast-uri`, `js-yaml`, `ip-address`, `npm`, `tar`, and `undici`. The first
three reached consumer build tooling; the last four were confined to the
development dependency chain through `@semantic-release/npm`.

A freshly packed consumer, installed on Node.js 24.13.0 with the Whisk
fixture's existing overrides, independently resolved `brace-expansion`
1.1.18/5.0.9, `fast-uri` 3.1.7, and `js-yaml` 3.15.2/4.3.2/5.4.1.
All three targeted advisory ranges are absent. Both its full audit and
`--omit=dev` audit report six high entries: the same five-package residual
chain plus its affected parent, `@emulsify/core`. That extra parent entry
is not another advisory. The consumer's higher root `js-yaml` patch/minor
resolution illustrates why a fresh consumer tree is distinct from Core's
locked tree.

## Residual Browser Extraction Chain

The remaining entries are `pa11y`, its nested `puppeteer` and
`puppeteer-core`, their `@puppeteer/browsers`, and `extract-zip`. These
entries all reach consumer dependencies because Core supplies Pa11y as build
and accessibility tooling. No release-only advisory entries remain in this
measured tree.

[`GHSA-jmr9-qjv8-65gv`](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)
has no patched `extract-zip` release at review time. The relevant code path
is browser installation: Pa11y's Puppeteer browser installer downloads an
archive and calls `unpackArchive()`, whose ZIP branch invokes `extract-zip`.
A malicious archive can contain symlinks outside the extraction directory.
The exposure is therefore on developer or CI machines processing browser
archives, including configured download mirrors or caches. Scanning an
already-installed browser does not itself extract an archive. No exploit
against a site visitor or shipped Core component was demonstrated here.

Keep browser-download sources and caches trusted, and keep build/install
jobs away from unnecessary credentials. These operational precautions do not
remove the advisory or establish that the residual risk has been accepted.
The release does not force Pa11y 10 or Puppeteer 25 on consumers to silence
the report; that requires a separate compatibility decision, including
platform unzip prerequisites and changed axe results.

Owner: unresolved.

<!-- MAINTAINER DECISION REQUIRED: Assign an accountable owner for the residual Pa11y/Puppeteer/extract-zip chain and decide whether its current exposure is temporarily acceptable. -->

Next review date: unresolved.

<!-- MAINTAINER DECISION REQUIRED: Set the next review date for the residual browser extraction chain and identify the supported CI images and download/caching practices to review. -->

## Consumer Action

Core's repository lockfile is not installed into a consuming theme. Refresh
the theme's own lockfile within its compatible dependency ranges, then run
its security audit and build checks. Updating `@emulsify/core` alone can leave
already-locked vulnerable transitives in place. Existing root overrides
remain subject to the [root-only boundary](migration-4x.md#install-warning-controls);
this release adds no overrides that claim to control a consumer's tree.

Reproduce the Core review with `npm ci` followed by `npm audit --json` and
`npm audit --omit=dev --json`. Run `npm run fixtures:consumer` for executable
packed-consumer compatibility coverage. Independently install the tarball
from `npm pack --ignore-scripts` into a fresh theme-shaped project and audit
that project's lockfile to verify consumer resolution. Registry advisory
results and newly resolved compatible versions can change after this review.
