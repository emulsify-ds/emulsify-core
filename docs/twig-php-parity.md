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

## Reproduce The Checks

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
On a maintainer machine with PHP compatible with Drupal 11.4.6, Composer, and
Git, create an isolated source checkout and runtime from the Core repository:

```sh
parity_dir="$(mktemp -d)"
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

An existing sibling checkout with the pinned dependencies also works:

```sh
php scripts/maintainer/check-twig-php-parity.php ../emulsify_tools
```

To deliberately regenerate the PHP observations, add `--write` to the PHP
command, format `src/extensions/twig/__fixtures__/parity-v1.json` with the
repository's Prettier configuration, and review its diff. Then rerun the PHP
check and Jest. Do not regenerate away a compatibility change: explain each
changed observation and resolve the open maintainer decisions first. A new
corpus schema or intentionally different counterpart should use a new corpus
version so the original evidence remains identifiable.
