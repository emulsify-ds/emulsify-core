# Audit and deprecations for 3.5.1

After `npm install` and `npm update` with lifecycle scripts enabled, `npm audit --json` reports **33 affected packages: 8 low, 10 moderate, 12 high and 3 critical**. This is a reduction from the initial refreshed graph's 52 findings. These counts include owning packages marked vulnerable by their dependencies; they are not 33 independent vulnerabilities. The exact npm output is in [npm-audit.json](maintenance-3.5.1/npm-audit.json). Registry manifests proving the upstream constraints are in [upstream-limitations.json](maintenance-3.5.1/upstream-limitations.json).

This maintenance change is **not a clean security audit**. The unresolved findings below need upstream releases or consumer migrations outside the scope of a compatible 3.x patch. No audit output, lifecycle scripts or tests were suppressed to obtain these results.

| Owning integration and actual installed chain | Finding | Why it remains |
| --- | --- | --- |
| `@emulsify/cli@1.12.2 → ajv@7.2.4` | Moderate: [AJV ReDoS with $data](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6), fixed in 8.18.0 | The CLI 1 range is `ajv ^7.2.4`. CLI 2 changes CLI workflows and introduces strict project schema validation, so requiring that migration would break the 3.x consumer contract. |
| `@emulsify/cli@1.12.2 → simple-git@3.36.0 → @simple-git/argv-parser@1.1.1` | Critical: [unsafe trailer command configuration](https://github.com/advisories/GHSA-x6jw-m9v5-85vh), [config includes](https://github.com/advisories/GHSA-g4wm-2vf7-vfgr), [option abbreviation bypass](https://github.com/advisories/GHSA-858h-whjf-mvg5), [VISUAL editor bypass](https://github.com/advisories/GHSA-v5rq-49vh-5v5c) | Current CLI 1 allows only simple-git 3.x. Latest CLI 2.4.1 also depends on `simple-git ^3.36.0`; upgrading it does not permit the simple-git 4.x fixes. Core cannot change an upstream dependency range through a supported release. |
| `storybook@9.1.21 → @vitest/mocker@3.2.4` | Moderate: [redirect mock file access](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) and [manual mock registration injection](https://github.com/advisories/GHSA-qxg6-89mg-rqv8), fixed in 4.1.11/4.1.12 | Storybook 9 pins mocker 3.2.4. Moving consumers' custom CommonJS addon presets to Storybook 10's native ESM contract is a consumer migration, excluded from this patch. |
| `@storybook/builder-webpack5@9.1.21 → webpack-dev-middleware@6.1.3` | High: [publicPath traversal](https://github.com/advisories/GHSA-g84c-rxfj-3j2c) | The builder declares `^6.1.2`. Current builder 10.6.5 still declares the same range, so the latest Storybook major does not eliminate this finding either. Patched middleware versions fall outside the supported upstream builder range. |
| `jest@30.5.2 → jest-config@30.5.2 → deepmerge@4.3.1`; `style-dictionary@5.7.1 → @bundled-es-modules/deepmerge@4.3.2 → deepmerge@4.3.1`; `@storybook/builder-webpack5@9.1.21 → fork-ts-checker-webpack-plugin@8.0.0 → deepmerge@4.3.1` | Low: [prototype poisoning](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | The advisory lists no patched deepmerge version. Current stable owning integrations still use it. npm's suggested Jest 25 / Style Dictionary 3 downgrades would remove supported behavior and are not suitable fixes. |
| `twig@1.17.1 → locutus@2.0.39` | Critical aggregate: [call_user_func_array RCE](https://github.com/advisories/GHSA-fp25-p6mj-qqg6), [create_function RCE](https://github.com/advisories/GHSA-vh9h-29pq-r5m8), [prototype pollution](https://github.com/advisories/GHSA-vc8f-x9pp-wf5p), [unserialize pollution](https://github.com/advisories/GHSA-4mph-v827-f877) | Twig 1 declares `locutus ^2.0.11`. Its maintained-major fixes require Locutus 3. Twig 3 is stable, but it does not satisfy the current Twig loader and extension peers (`twig 1.x` / `^1.13.3`). Replacing the Twig integration would be a consumer migration. |
| `twig@1.17.1 → minimatch@3.0.8` | High: [wildcard ReDoS](https://github.com/advisories/GHSA-3ppc-4f35-3m26), [GLOBSTAR backtracking](https://github.com/advisories/GHSA-7r86-cg39-jmmj), [nested extglob ReDoS](https://github.com/advisories/GHSA-23c5-xmqv-rm74) | Twig 1 declares `minimatch 3.0.x`, which excludes the patched 3.1.x releases. Latest compatible Twig 1 does not widen that range. |
| Maintainer-only: `semantic-release@25.0.9 → @semantic-release/npm@13.2.0 → npm@11.21.1 → … → ip-address@10.7.2` | Moderate: [IPv6 zone parsing ReDoS](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5) | This is part of npm's bundled dependency tree, which normal resolution does not replace. Current @semantic-release/npm permits npm 11 only. A supported upstream npm/plugin release is needed. |
| Maintainer-only: `semantic-release@25.0.9 → @semantic-release/npm@13.2.0 → npm@11.21.1 → node-gyp@12.4.0 → undici@6.29.0` | High: [EventSource memory growth](https://github.com/advisories/GHSA-4qv8-2p9j-2685), [content encoding exception](https://github.com/advisories/GHSA-xjj6-f33q-929c), [TLS option loss](https://github.com/advisories/GHSA-2m5v-pch6-74hx), [TLS renegotiation DoS](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm), [PONG buffering](https://github.com/advisories/GHSA-9fm3-97px-rjf6) | npm 11.21.1 bundles this older undici despite current 6.29.1 being installed elsewhere. Current release plugin range excludes npm 12. Manual edits or transitive pins would not be a supported resolution. |

All 33 npm audit package records are accounted for by those chains:

- CLI: `@emulsify/cli`, `ajv`, `simple-git`, `@simple-git/argv-parser`.
- Storybook: `storybook`, `@vitest/mocker`, `@storybook/addon-a11y`, `@storybook/addon-links`, `@storybook/addon-themes`, `@storybook/builder-webpack5`, `@storybook/core-webpack`, `@storybook/preset-server-webpack`, `@storybook/server`, `@storybook/server-webpack5`, `webpack-dev-middleware`.
- Deepmerge: `deepmerge`, `@bundled-es-modules/deepmerge`, `fork-ts-checker-webpack-plugin`, `style-dictionary`, `jest`, `jest-cli`, `@jest/core`, `jest-config`.
- Twig: `twig`, `locutus`, `minimatch`, `add-attributes-twig-extension`, `bem-twig-extension`, `twig-drupal-filters`, `twig-testing-library`, `twigjs-loader`.
- Maintainer npm bundle: `ip-address`, `undici`.

## Consumer lockfile results

The packed-artifact macOS checks also audit the actual installed consumers; these differ from the maintainer checkout because development dependencies are absent and npm preserves compatible historical lock entries on upgrade.

| Installed graph | Low | Moderate | High | Critical | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Maintainer checkout, refreshed lockfile | 8 | 10 | 12 | 3 | 33 |
| Fresh 3.5.1 consumer | 8 | 9 | 12 | 3 | 32 |
| Upgrade from the historical 3.5.0 consumer lockfile | 9 | 10 | 16 | 3 | 38 |

The consumer audit adds an aggregate `@emulsify/core` record and excludes the two release-only npm-bundle findings. The upgraded consumer additionally retains these six old transitive versions, all permitted by their owners' dependency ranges:

| Retained package | Owning chain | Compatible fixed version installed in the fresh fixture |
| --- | --- | --- |
| `@humanfs/node@0.16.7` | Core → ESLint 10.13.0 → @humanfs/node | 0.16.8 |
| `brace-expansion@1.1.14` | Core → Twig 1.17.1 → minimatch 3.0.8 → brace-expansion | 1.1.21 |
| `fast-uri@3.1.0` | Core → Webpack 5.112.2 → schema-utils 4.8.1 → AJV 8.20.0 → fast-uri | 3.1.9 |
| `immutable@5.1.5` | Core → Sass 1.106.1 → immutable | 5.1.9 |
| `js-yaml@3.14.2` | Core → js-yaml-loader 1.2.2 → js-yaml | 3.15.2 |
| `serialize-javascript@7.0.5` | Core → copy-webpack-plugin 14 / image-minimizer-webpack-plugin 5 → serialize-javascript | 7.1.4 |

These six findings can be refreshed through supported npm dependency updates; they are not blocked by an upstream range. A maintainer may run `npm update` in the consumer and review the resulting lockfile to refresh versions allowed by the project's existing ranges. That can also update other project dependencies, so it is a separate dependency refresh from the required Core upgrade. The resolver installation fix itself requires only the documented Core update and updated lockfile: both the historical upgrade and subsequent `npm ci` resolve unrs-resolver 1.12.2 successfully even when these unrelated historical entries remain.

Exact consumer audit output is retained in [consumer-audit-fresh-macos.json](maintenance-3.5.1/consumer-audit-fresh-macos.json), [consumer-audit-upgrade-macos.json](maintenance-3.5.1/consumer-audit-upgrade-macos.json), and [consumer-macos-final.json](maintenance-3.5.1/consumer-macos-final.json).

## Deprecations

The final lockfile retains three deprecated packages:

| Package | Owner and reason |
| --- | --- |
| `token-transformer@0.0.33` | Direct dependency. No newer stable release exists. The [3.x starter's tokens:transform command](https://github.com/emulsify-ds/emulsify-drupal/blob/7a26035005bae1a7a45ac56c95d44f15fc06f28c/whisk/package.json) calls its CLI; removing or replacing the token format would break consumers. |
| `whatwg-encoding@3.1.1` | `jest-environment-jsdom@30.5.2 → jsdom@26.1.0 → whatwg-encoding@3.1.1` (also through html-encoding-sniffer). Jest's current `jsdom ^26.1.0` range excludes jsdom's new encoding implementation. |
| `glob@10.5.0` | `jest@30.5.2 → @jest/transform@30.5.2 → babel-plugin-istanbul@8.0.0 → test-exclude@7.0.2 → glob@10.5.0`. Latest test-exclude 8 uses glob 13, but babel-plugin-istanbul's `test-exclude ^7.0.1` excludes it. Disabling coverage or pinning a transitive dependency would weaken or circumvent the integration. |

The removed clean-webpack-plugin and node-sass-glob-importer integrations previously depended on old glob/rimraf/inflight chains; Webpack cleaning and the supported glob/Sass importer integration replace their Core functionality. The removed imagemin native binary integrations also avoid the old bin-build/bin-wrapper download-and-compile stack. Existing root overrides are removed; consumer installations resolve from supported package manifests.

Every production package's declared Node engine in the final lockfile admits Node 24.0.0. The release-only semantic-release/npm/GitHub packages retain their preexisting Node >=24.10 floor; this does not alter consumer Node >=24 support.
