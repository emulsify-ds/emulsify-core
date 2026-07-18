# Project Audit

`emulsify-audit` scans an Emulsify project for migration and configuration
problems. Its default report is intended for people. The `--json` report is a
versioned interface for CI systems and downstream tools.

Run the audit from an installed project:

```sh
npx --no-install emulsify-audit
```

From an Emulsify Core checkout, select another project root explicitly:

```sh
node scripts/audit.js --root /path/to/project
```

Findings do not change the default exit status. Use a failure threshold when
the audit should enforce policy in CI.

## JSON Report Contract

Use `--json` to write exactly one JSON document to stdout:

```sh
npx --no-install emulsify-audit --json > audit-report.json
```

A schema-version 1 report has this shape:

```json
{
  "schemaVersion": 1,
  "tool": {
    "name": "@emulsify/core",
    "version": "4.3.0"
  },
  "root": ".",
  "summary": {
    "error": 0,
    "warn": 1,
    "info": 0
  },
  "files": {
    "stories": 1,
    "twig": 1,
    "code": 1,
    "styles": 0
  },
  "findings": [
    {
      "id": "legacy-twig-story",
      "severity": "warn",
      "path": "src/components/card/card.stories.js",
      "line": 5,
      "message": "Twig story appears to return an HTML string directly. This remains compatible, but renderTwig() is preferred for active migrations.",
      "details": [
        "imports Twig templates without renderTwig()",
        "appears to return Twig HTML strings directly"
      ],
      "docs": "https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/storybook.md#legacy-twig-story-compatibility"
    }
  ]
}
```

The top-level fields are:

- `schemaVersion`: Integer version of the JSON contract. This is independent of
  the package version and changes only for incompatible contract changes.
- `tool`: Package identity. `tool.version` is the installed Emulsify Core
  version and changes independently of `schemaVersion`.
- `root`: Always `"."`, representing the selected scan root.
- `summary`: Finding counts. The `error`, `warn`, and `info` keys are always
  present, including when their value is zero.
- `files`: Counts for the normalized story, Twig, code, and style scan sets.
  These categories can overlap; for example, a JavaScript story is counted in
  both `stories` and `code`. Do not add them together as a unique-file total.
- `findings`: Findings in deterministic scan order.

Each finding contains:

- `id`: Stable identifier intended for filters and automation.
- `severity`: One of `error`, `warn`, or `info`.
- `message`: Human-readable explanation.
- `path`: Optional project-relative path using `/`, with no leading `./`.
- `line`: Optional positive, one-based line number.
- `details`: Optional array of human-readable detail strings.
- `docs`: Optional documentation URL.

Optional finding fields are omitted when unavailable. They are not emitted as
`null` or as internal `undefined` values. Reports do not expose internal
absolute file paths or the machine-specific selected-root path.

### Compatibility Expectations

The following are part of the machine-readable contract:

- required field names and value types;
- severity names and meanings;
- finding object field names and value types;
- existing finding IDs.

Renaming or removing those fields or IDs, or changing their meaning
incompatibly, requires a `schemaVersion` increase. Adding a new finding ID or a
new optional field is compatible and does not require a schema-version change.
Consumers should tolerate both.

Finding messages, details, documentation URLs, counts, and ordering can change
as checks improve or project contents change. Output ordering is deterministic
for reproducible reports, but consumers should select JSON fields by name
rather than relying on object-key order.

The focused `emulsify-audit-twig-stories --json` command uses the same envelope
and normalized finding shape. Its `files` counts describe only that focused
story scan, and its existing `--fail-on-found` option remains the way to make
migration candidates fail the command.

## Failure Thresholds

For the combined `emulsify-audit` command, `--fail-on` controls whether a
completed scan exits with status 1:

| Option            | Exit 1 when the completed scan contains      |
| ----------------- | -------------------------------------------- |
| No threshold      | Never because of findings                    |
| `--fail-on error` | At least one error                           |
| `--fail-on warn`  | At least one error or warning                |
| `--fail-on info`  | At least one error, warning, or info finding |
| `--fail-on any`   | Any finding                                  |
| `--fail-on-found` | Compatibility alias for `--fail-on any`      |

The process exit codes are:

- `0`: The scan completed and did not meet its failure threshold.
- `1`: The scan completed and met its failure threshold.
- `2`: Arguments were invalid, or audit setup/execution failed.

An exit status of 1 still produces a normal report. In JSON mode, an exit
status of 2 produces a distinct error document instead of a findings report:

```json
{
  "schemaVersion": 1,
  "tool": {
    "name": "@emulsify/core",
    "version": "4.3.0"
  },
  "error": {
    "code": "invalid-arguments",
    "message": "--fail-on must be one of: error, warn, info, any."
  }
}
```

The error code is `invalid-arguments` for command-line errors and
`audit-failed` for setup or execution failures. JSON errors are written as one
document to stdout without usage text. Human-readable errors retain concise
messages and usage guidance on stderr. `--help` is human-readable and should
not be combined with `--json`.

## CI Examples

Preserve the audit status while inspecting its report:

```sh
status=0
npx --no-install emulsify-audit --json --fail-on warn > audit-report.json || status=$?
jq '{summary, files}' audit-report.json
exit "$status"
```

Use `jq` to own a custom findings policy while leaving the audit itself
non-failing:

```sh
npx --no-install emulsify-audit --json |
  jq -e '.summary.error == 0 and .summary.warn == 0'
```

Filter by stable finding ID:

```sh
jq '.findings[] | select(.id == "legacy-twig-story")' audit-report.json
```
