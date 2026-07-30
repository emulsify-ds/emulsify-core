# Develop Reporter

`npm run develop` runs a Vite watch build and a Storybook dev server side by side
under `concurrently`. The develop reporter is what makes that read as one tool
instead of three.

The reporter is active only for `vite build --watch`. One-shot `npm run build`,
`storybook build`, and every release fixture verification keep their default
output byte for byte, so nothing a platform ships is affected by anything on this
page.

## What It Prints

A watch session opens with the wordmark and the Core version:

```text
  █▀▀ █▀▄▀█ █ █ █   █▀▀ █ █▀▀ █ █
  █▀▀ █ ▀ █ █ █ █   ▀▀█ █ █▀▀ ▀▄▀
  ▀▀▀ ▀   ▀ ▀▀▀ ▀▀▀ ▀▀▀ ▀ ▀    ▀

  core 4.4.0
```

Then, once the first build finishes, the project facts and the build result:

```text
      platform    Drupal
      input       src/components/   28 entries
                  src/layout/        6 entries
                  src/foundation/    5 entries
      output      dist/  41 files · 2.3 MB · largest style.css 388 kB

  ✓ built in 2.55s · watching dist/
```

### Reading The Input Rows

One row per source root, naming the directory and how many build entries came
out of it. The roots are the project's resolved structure:

- With `variant.structureImplementations` in `project.emulsify.json`, each
  configured root appears in the order it was declared.
- Without it, the discovered `src/components` (or root `./components`) appears,
  followed by the global root.

**A root reporting `0 entries` is highlighted, and it is usually a bug.** Either
the path in `project.emulsify.json` is wrong, or the directory is empty, or the
files in it are not recognized as entries. A total entry count cannot tell you
this — 39 entries looks healthy whether or not a root was found at all. See
[Project Structure And Output](project-structure.md) for how roots resolve.

### Reading The Output Row

The output directory, then the number of files written, their combined size, and
the largest single file. Watching the largest file is the cheapest way to notice
a stylesheet that has begun pulling in something it should not.

## Problem Blocks

Problems are grouped under two headings, actionable first:

```text
  ── needs attention ─────────────────────────────────
```

Errors, missing Sass imports, CSS syntax errors, warnings, and unresolved CSS
asset URLs. These usually relate to the edit you just made.

```text
  ── pre-existing debt ───────────────────────────────
```

Sass deprecations, collapsed into a worklist: total, then each affected file with
the deprecation kinds inside it, then the `sass-migrator` command that resolves
most of them. Most projects inherit hundreds of these, and they are separated so
they stop competing for attention with problems from this build.

A heading is only drawn when it has content.

Each block is capped. When more problems exist than are listed, the block ends
with a `+N more` count rather than growing without limit.

## Rebuilds

After the first build, each cycle is one line:

```text
  09:14:02 ~ src/components/atoms/buttons/_buttons.scss · rebuilt in 84ms
```

Deprecations are not repeated on rebuilds — restating 190 of them on every
keystroke would recreate the noise the reporter exists to remove. Failures are
reported in full.

## Storybook

Storybook's `Storybook ready!` box is replaced with the same panel treatment, so
both halves of `develop` speak in one voice:

```text
  ✓ storybook ready

  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
    local     http://localhost:6007/
    network   http://192.168.1.25:6007/
  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
```

### Port Drift

Consumers run `storybook dev --ci`, and under `--ci` Storybook takes the next
free port without prompting when the requested one is busy. The reporter compares
the port it asked for against the port it got and says so:

```text
  ! storybook ready · port 6006 in use, using 6007
```

That line almost always means a previous session is still running. Without it, a
browser pointed at the requested port would be showing a stale instance with
nothing anywhere explaining why.

Because Vite and Storybook are separate processes, the Storybook panel and the
Vite summary appear in whichever order the two finish. Each block is
self-contained.

## Environment Variables

| Variable                | Effect                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EMULSIFY_VERBOSE=1`    | Stand aside entirely. Restores Vite's and Rolldown's raw output, including the per-file asset table and every Sass deprecation block. Use when diagnosing something the summary has collapsed. |
| `EMULSIFY_NO_UNICODE=1` | Drop the wordmark, the panel rules, and the section rules in favor of plain text. Applied automatically when the terminal's locale is not UTF-8.                                               |
| `NO_COLOR=1`            | Disable color. Honors the [no-color.org](https://no-color.org/) convention.                                                                                                                    |
| `FORCE_COLOR=1`         | Enable color even when the stream is not a TTY. `develop` pipes through `concurrently`, so this is occasionally useful.                                                                        |

## Why The Output Is Append-Only

Under `concurrently` this process writes to a pipe rather than a terminal, and
two things follow. Cursor control is unavailable, so anything that rewrote a line
in place would degrade into concatenated garbage. And Node disables color when
the stream is not a TTY, which is why color support is resolved from the
environment rather than from the stream.

Every line the reporter emits is therefore complete when written. This is also
why the reporter raises Vite's `logLevel` during a watch build: Rolldown's
progress line is written from native code with a `\x1b[2K\r` prefix and no
trailing newline, and that carriage return is what collides with Storybook's
output when `concurrently` merges both streams onto one pipe. Raising the level
is the only thing that removes it, and it also stops Rolldown computing gzip
sizes on every rebuild.
