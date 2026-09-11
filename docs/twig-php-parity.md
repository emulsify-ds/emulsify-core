# Twig And PHP Parity Corpus

[The version 1 corpus](../src/extensions/twig/__fixtures__/parity-v1.json) records
Core's current `bem()` and `add_attributes()` output next to Emulsify Tools PHP
output. These are observations, including known divergences, rather than a
decision that either runtime is correct. No helper behavior changes in 4.5.0.

The PHP source is pinned to Emulsify Tools
[`26a5b7cf7abd5f6d05843c70af17f09a354a8e81`](https://github.com/emulsify-ds/emulsify_tools/tree/26a5b7cf7abd5f6d05843c70af17f09a354a8e81).
Expectations were generated with PHP 8.5.10, Drupal Core 11.4.6, and Twig PHP
3.28.0. The corpus also records the exact Drupal and Twig dependency references;
the optional check rejects mismatched source files or serializer dependencies.
This pin identifies the evidence, not a supported Core/Tools version pairing.

## Current Differences

The table shows attribute values; the corpus preserves the complete serialized
strings and the context left after rendering.

| Same logical input                                                     | Core JavaScript                   | Pinned Tools PHP                 |
| ---------------------------------------------------------------------- | --------------------------------- | -------------------------------- |
| Object BEM `{block: 'card', element: 'title', modifiers: ['small']}`   | `card__title card__title--small`  | `title__card title__card--small` |
| Extra class `md:w-1/2`                                                 | `md-w-1-2`                        | `md:w-1/2`                       |
| Context `disabled: true`, additional `disabled: false`                 | Keeps `disabled`                  | Omits `disabled`                 |
| Context `aria-describedby: ['a']`, additional `['b']`                  | `b`                               | `a b`                            |
| Repeated helper calls with plain PHP array / JavaScript object context | Consumes attributes on first call | Prints attributes again          |

Drupal's `Attribute` serializer also prepends a space to nonempty output and
encodes apostrophes as `&#039;`; Core's serializer does neither. These are known
serialization differences even when the browser receives equivalent attributes.
Each divergent fixture has a comment explaining what it records. The tests keep
the whitespace and escaping differences visible instead of normalizing the
recorded strings.

## Portable Subset

For the pinned implementations, the corpus verifies equivalent browser-visible
attributes for these inputs:

- Positional BEM: `bem('title', ['small'], 'card', ['js-click'])`.
- Object BEM using explicit `base_class` and `blockname` keys, with string values
  and arrays of modifiers/extras. The `block`/`element` shorthand is outside this
  subset.
- Simple class tokens beginning with a letter or underscore and containing only
  ASCII letters, digits, underscores, and hyphens, passed as separate array items.
- Scalar attributes, standalone `true`/`false`/`null` values, and list attributes
  supplied from one source. An incoming `false` must not be used to remove an
  existing context attribute; list replacement/merging across sources differs.
- Escaped double quotes, ampersands, angle brackets, and apostrophes in ordinary
  string values. Apostrophe encoding differs in bytes but has the same HTML value.
- Class merging and print-once context consumption when Drupal supplies a native
  `Drupal\Core\Template\Attribute` object and Core receives its plain JavaScript
  object equivalent. PHP plain-array context is outside the print-once subset.

Use helpers in a spaced attribute position, such as
`<div {{ add_attributes(additional) }}></div>`. Equivalent browser attributes do
not imply byte-identical HTML: Drupal's leading space remains present. The Jest
test checks both exact Core strings and DOM attribute equivalence for cases
marked `portableAttributes`; it also confirms the other cases remain divergent.
This small corpus does not establish equivalence for arbitrary attribute objects,
malformed attribute names, every Twig expression, or other Tools helpers.

Utility classes with punctuation are currently outside the portable subset.
Core's native attribute helpers turn `md:w-1/2` into `md-w-1-2`, including when it
is passed through `add_attributes()`. Tools retains the original token. Consumers
must account for that limitation in shared templates; 4.5.0 does not change
selectors or silently harmonize either implementation.

The [maintainer decision register](maintainer-decisions.md#supported-emulsify-tools-counterparts)
tracks unresolved decisions about a supported Tools pairing and
[future helper behavior](maintainer-decisions.md#future-bem-and-attribute-helper-behavior).
This release preserves the observed outputs and portable subset above.

## Optional Maintainer Workflow

Run [Optional Twig PHP parity](../.github/workflows/twig-php-parity.yml) from
GitHub Actions using **Run workflow** and select the Core ref to verify. The
equivalent command for the release source branch is:

```sh
gh workflow run twig-php-parity.yml --ref develop
```

This manual entry point runs independent JavaScript and PHP jobs, so a failed
PHP setup does not hide the JavaScript result. It has no push, pull-request,
schedule, or publication trigger and is not a required release check. Ordinary
Core installation and tests remain JavaScript-only. The workflow and PHP
checker are excluded from the published package.

The JavaScript job uses `.nvmrc` and `npm ci` against Core's lockfile, with
install hooks disabled because the focused Jest check needs no browser download
or other installation hook. It runs the existing corpus test unchanged:
exact Core strings and remaining context attributes, plus browser-equivalence
checks only for cases marked `portableAttributes`. Known differences remain
asserted as differences.

The PHP job uses an isolated directory under the runner's temporary directory;
it never modifies a sibling Tools checkout. It fetches the corpus's exact Tools
revision and installs only the two direct serializer dependencies recorded in
the corpus, plus their Composer requirements. It creates no Drupal site and
runs no Composer plugins or project scripts. The checker verifies exact Tools
helper source bytes and installed Drupal/Twig versions and references before
comparing output.

The workflow selects the compatible **PHP 8.5** line and Composer **2.10.3** on
Ubuntu 24.04. The setup action selects an available PHP patch within that line;
it does not lock PHP to the original **8.5.10** observation. Each run records
the actual PHP version alongside the corpus's generation version. Other
Composer transitives are freshly resolved within the pinned packages'
constraints, and the generated lockfile is retained to identify that run's
complete graph. To repeat the original PHP patch locally, use PHP 8.5.10 with
the isolated setup below; to repeat a workflow's dependency graph, reuse its
archived `composer.json` and `composer.lock` with `composer install`.

This verifies a pinned set of observations on the recorded environment, not
every PHP/Twig environment or an officially supported Core/Tools pairing.
Changes in output still require a separate
[compatibility decision](maintainer-decisions.md#future-bem-and-attribute-helper-behavior).

### Results And Diagnostics

Each job keeps its nonzero result on failure. Artifacts named
`twig-parity-javascript` and `twig-parity-php` retain small logs and dependency
metadata for seven days, including failed runs when artifacts are available.
They include the Core SHA, runtime versions, Jest results, source/dependency
pins, and the PHP job's generated Composer manifest/lockfile; they omit
`node_modules`, `vendor`, and caches. Setup-action failures remain in the
Actions log even if setup failed before artifact files could be created.

- **Environment:** An unavailable runtime, checkout, autoloader, or failed
  installation is a setup failure, not an output comparison.
- **Provenance:** A source or dependency mismatch identifies the Tools file
  and expected/observed hashes, or the package's expected/observed version
  and reference. The checker stops before rendering unverified sources.
- **Output:** PHP mismatch records identify the runtime/version, case ID,
  expected value, and observed value, including exact strings and remaining
  context attributes. Jest reports the case and expected/received values in
  its JavaScript job and JSON artifact. Neither side trims strings or
  normalizes escaping to make a mismatch pass.
- **Execution:** A PHP rendering exception identifies the runtime and case;
  it is distinct from a completed comparison with unequal output.

The workflow has read-only repository permissions, does not retain checkout
credentials, and does not receive publishing credentials. It never invokes
`--write`, updates expectations, commits changes, or opens pull requests. Its
actions use reviewed commit pins under the existing Dependabot policy.

## Reproduce The Checks Locally

Core's regular Jest suite runs the corpus without PHP or Composer:

```sh
npm test -- --runInBand
```

For a focused check without global coverage thresholds:

```sh
npm test -- --runInBand --coverage=false src/extensions/twig/__tests__/php-parity.test.js
```

PHP execution is an optional maintainer check. It is not part of Core's npm
scripts, required CI, package contents, or contributor/consumer requirements.
On a maintainer machine with PHP 8.5.10, Composer 2.10.3, and Git, create an
isolated source checkout and runtime from the Core repository:

```sh
parity_dir="$(mktemp -d)"
export COMPOSER_HOME="$parity_dir/composer-home"
export COMPOSER_CACHE_DIR="$parity_dir/composer-cache"
git clone https://github.com/emulsify-ds/emulsify_tools.git "$parity_dir/tools"
git -C "$parity_dir/tools" checkout --detach 26a5b7cf7abd5f6d05843c70af17f09a354a8e81
mkdir "$parity_dir/runtime"
composer --working-dir="$parity_dir/runtime" require \
  drupal/core:11.4.6 twig/twig:3.28.0 --no-interaction --no-plugins --no-scripts
php scripts/maintainer/check-twig-php-parity.php \
  "$parity_dir/tools" "$parity_dir/runtime/vendor/autoload.php"
```

The check compares the three Tools helper source files with the pinned Git
revision and validates installed Drupal/Twig versions and references before
executing the shared Twig templates. Context defaults to a native Drupal
`Attribute` object; the plain-array fixture explicitly opts out. Both runtimes
render with Twig autoescaping disabled so this measures the helpers' own
attribute serialization. Raw output and remaining context attributes must match
every recorded PHP expectation or the command exits unsuccessfully.

The PHP CLI accepts other compatible PHP versions; it records its actual
version in failure diagnostics. The original generation used 8.5.10. A Tools
checkout at the right revision can still have an older `vendor` tree, so use
the separate pinned runtime instead of assuming sibling dependencies match.
Keep the temporary directory while investigating failures; remove that
task-owned directory after saving any evidence you need.

## Deliberately Updating Observations

Regeneration is a separate local maintainer action. First resolve any intended
helper-output change through the compatibility decision and prepare isolated
Tools/serializer sources with verified pins. For an intentionally different
counterpart or corpus schema, use a new corpus version so the original evidence
remains identifiable, and update the checker, test, workflow, and documented
pins together. Changing a pin does not itself approve a supported pairing.

To refresh PHP observations for the existing corpus after that review, run:

```sh
php scripts/maintainer/check-twig-php-parity.php \
  "$parity_dir/tools" "$parity_dir/runtime/vendor/autoload.php" --write
npx --no-install prettier --write --config config/.prettierrc.json \
  src/extensions/twig/__fixtures__/parity-v1.json
git diff -- src/extensions/twig/__fixtures__/parity-v1.json
```

Review every changed rendered byte, remaining-context value, and generation
metadata field. Keep comments and portable-subset markings aligned with the
evidence; do not regenerate or normalize away a compatibility difference.
`--write` updates PHP observations, not Core expectations. Rerun PHP without
`--write`, the focused Jest test, and the optional workflow before treating
the refreshed record as verified.
