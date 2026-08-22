# Develop Reporter

`npm run develop` runs a Vite watch build and a Storybook dev server side by side
under `concurrently`. The develop reporter is what makes that read as one tool
instead of three.

The full session report is active only for `vite build --watch`. One-shot builds
keep their normal output and add a compact block only for actionable asset
diagnostics or, in a standalone `storybook build`, Sass deprecations that its
quiet logger collected. Clean builds and release fixture verification remain
unchanged, so nothing a platform ships is affected by the presentation here.

## What It Prints

A watch session opens with the wordmark and the Core version:

```text
  █▀▀ █▀▄▀█ █ █ █   █▀▀ █ █▀▀ █ █
  █▀▀ █ ▀ █ █ █ █   ▀▀█ █ █▀▀ ▀▄▀
  ▀▀▀ ▀   ▀ ▀▀▀ ▀▀▀ ▀▀▀ ▀ ▀    ▀

  core 4.4.0
```

Then, once the first build finishes, the project facts and the build result, each
under its own heading:

```text
  ── project ──────────────────────────────────────────

      platform    Drupal
      input       src/components/   28 entries
                  src/foundation/    5 entries
                  src/base/          3 entries
                  src/js/            2 entries
      output      dist/         9 files · 400 kB · largest global/style.css 388 kB
                  components/  32 files · 1.9 MB · largest forms/inputs/select/select.js 77 kB
                  total        41 files · 2.3 MB

  ── build ────────────────────────────────────────────

  ✓ built in 2.55s · watching src/
```

The headings exist because `develop` runs two processes through one pipe.
Storybook's own startup lines land between the banner and this block, so without
them the facts opened against whatever Storybook happened to print last. They use
the same vocabulary as the problem headings below, which makes the whole summary
one sequence of labelled sections rather than a wall of rows followed by some
dividers.

### Reading The Input Rows

One row per source root, naming the directory and how many build entries came
out of it. The roots are the project's resolved structure:

- Without `variant.structureImplementations`, the discovered `src/components`
  (or root `./components`) appears, followed by the global root — which is the
  source directory itself, not a `global/` subdirectory of it.
- With `variant.structureImplementations` in `project.emulsify.json`, each
  configured root appears instead, in the order it was declared.

Because a global root is the whole source directory, it would otherwise report
one opaque total for everything outside the component roots — a bare `src/` row
naming a number but not a location. So every directory one level inside the root
gets its own row. The conventional names — `foundation/`, `base/`, and `global/` —
sort first so the usual layout reads the same way across projects, and the rest
follow alphabetically.

Files sitting directly in the root have no directory to attribute to and stay on
the root's own row. Past eight directories the remainder collapses into a
`+N more directories` row that still carries its entries, so the counts always
reconcile against the total.

This is a reporting distinction only. The build already treats every directory
under a global root the same way, emitting each to `dist/global/<name>/`, and
these rows just make that visible. See
[Project Structure And Output](project-structure.md) for how roots resolve.

**A root reporting `0 entries` is highlighted, and it is usually a bug.** Either
the path in `project.emulsify.json` is wrong, or the directory is empty, or the
files in it are not recognized as entries. A total entry count cannot tell you
this — 39 entries looks healthy whether or not a root was found at all.

### Reading The Output Row

Each final output destination gets its own row with the number of files in that
part of the emitted bundle, their combined size, and the largest file relative
to that directory. Drupal projects that mirror SDC output show separate `dist/`
and `components/` rows followed by their combined total. Other projects show
only their Vite output directory, without a redundant total row. Watching the
largest file in each destination is the cheapest way to notice a stylesheet or
component bundle that has begun pulling in something it should not.

### Reading The Build Line

`watching src/` names what the watcher is actually watching, which is the source
tree — `dist/` is written, not watched. The label is the deepest directory every
source root sits inside, so it stays true as roots are added: two roots under
`src/` report `src/`, a single `components/` root at the project root reports
`components/`. Roots in unrelated trees share no honest parent, and those report
`watching sources` rather than naming one and misrepresenting the other.

## Problem Blocks

Problems continue the same headings, actionable first. Unlike `project` and
`build`, these two are drawn only when they have content — labelling an empty
category advertises a problem the project does not have.

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

Each block is capped. When more problems exist than are listed, the block ends
with a `+N more` count rather than growing without limit.

## Rebuilds

After the first build, each cycle is one line:

```text
  09:14:02 ~ src/components/atoms/buttons/_buttons.scss · rebuilt in 84ms
```

Any file that ends up in `dist/` triggers one, including the templates and static
assets that are copied rather than compiled. Those are absent from Rollup's module
graph, so the copy plugins register them with `addWatchFile`; without that, saving
a Twig template produced no rebuild at all and `dist/` kept the previous version
until an unrelated stylesheet changed. Storybook renders Twig through its own
pipeline and looked correct throughout, which made the stale copy visible only to
whatever consumes `dist/`.

Story files deliberately do not trigger a Vite rebuild; Storybook watches those
itself. Every Twig template does, including ones whose names begin with an
underscore — Twig resolves `{% include %}` at render time against the emitted tree,
so those are files the site still has to find.

Adding a _new_ file is different from editing one. The copy plugins register
individual files rather than component directories, while the entry map and the
source index are resolved once at config time. Adding a file anywhere under a
component source root — including inside an existing component — therefore does
not start a Vite build cycle. Creating, renaming, or deleting a component
directory likewise requires restarting `develop`; the restart refreshes both the
watch set and compiled inputs. A single-file rename does produce a cycle because
deleting its individually watched original emits an event, though its old output
is retained until a restart or one-shot build cleans it.

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

### HMR Notices

Storybook's dev server logs an HMR notice for every module it pushes to the
browser, and one saved stylesheet produces several:

```text
│  Vite hmr update
│  /@id/__x00__virtual:/@storybook/builder-vite/project-annotations.js,
│  /@id/__x00__virtual:/@storybook/builder-vite/vite-app.js
│  Vite hmr update /dist/global/layout/layout.css
```

These are suppressed at the default level and restored in either verbose mode.
The rebuild line already reports the same event more precisely, and under
`concurrently` these interleave with it on the shared pipe.

There used to be many more of these. `build.emptyOutDir` clears the output
directory on **every** watch cycle, not just the first, and Storybook imports its
compiled CSS from `dist/`, so each save deleted and recreated every file
Storybook was watching. Deleting a file reached through an eager
`import.meta.glob` is a full-reload invalidation rather than a style swap, and
the copied Twig templates were rewritten on every cycle as well — so a one-line
stylesheet edit reloaded the preview iframe instead of swapping the stylesheet.

Emulsify now lets Vite empty the directory for the first cycle only, then writes
incrementally: an emitted asset, a copied template, or a copied static file whose
bytes already match what is on disk is left alone. One saved stylesheet updates
one stylesheet and the preview no longer reloads. The tradeoff is that output
from a component deleted or renamed mid-session is not pruned. Destinations
inside `outDir` are removed when the watcher restarts or a one-shot build empties
that directory. Drupal SDC component output mirrored outside `outDir` is not
reconciled automatically and may require manual cleanup after a delete or rename.

### Sass Deprecations From Storybook

Storybook runs its own Vite process, and it compiles the same stylesheets the
watcher does. It resolves the shared config with `command: 'serve'`, which used
to miss the branch that installs the quiet Sass logger, so Dart Sass printed its
full formatted block — message, recommendation, excerpt, caret, import chain —
for every deprecation it met. On a project carrying a few hundred of them that
is most of a screen at startup, and the same screen again after every save,
restating a tally the reporter had already printed once from the other process.

Storybook now takes the same logger. During `npm run develop`, the watcher
compiles the same source tree, so its `pre-existing debt` block already covers
everything Storybook dev would have reported. A standalone `storybook build`
has no sibling watcher, so it prints the collected, deduplicated Sass tally when
the build finishes.

The debt is never invisible. `npm run develop` prints it once per session,
`storybook build` prints it once at completion, and one-shot `npm run build`
keeps Dart Sass's own output untouched. `EMULSIFY_VERBOSE=1` hands Storybook's
raw output back.

### Transform Failures

A dev-server transform failure prints the error, then repeats it out of
`err.stack`, then lists thirty-odd frames inside `sass.dart.js` — roughly fifty
lines in which the only project path is in the first six. Everything from the
`File:` line on is dropped at the default level, leaving the message, the source
excerpt with its caret, the import chain, and the file:

```text
  [vite] Internal server error: [sass] expected ";".
    ╷
  5 │ @use '../../base/global/colors/color-vars' as *
    │                                                ^
    ╵
    src/components/organisms/tab-refresh/tab-refresh.scss 5:48  root stylesheet
    Plugin: vite:css
    File: src/components/organisms/tab-refresh/tab-refresh.scss:5:48
```

An error that carries neither a `File:` line nor a recognizable stack frame is
passed through whole rather than truncated on a guess, and either verbose mode
restores the full dump.

## Verbose Mode

Two ways in, both reaching the same place:

```bash
npm run develop --verbose
EMULSIFY_VERBOSE=2 npm run develop
```

The reporter still owns the output — nothing is handed back to Rolldown — but it
prints considerably more of what it knows.

### What Changes

The `project` section grows two listings. `input files` names every entry the
build reads with the size of its source, ordered by path, because a full input
listing is read to check that the tree was picked up and a tree is scanned in path
order. `output files` names every file the build wrote with its size and, where
the number means anything, its gzip size — ordered by size descending, since it is
the `output` row's `largest` expanded into the full ranking. Development source
maps are omitted because their generated metadata obscures the actionable files.

```text
  ── output files ──────────────────────────────────────

      file                                    size      gzip
      assets/images/nav-sprite.jpg        226.36 kB         —
      assets/icons.svg                     85.83 kB  31.73 kB
      global/layout/layout.css             12.11 kB   2.05 kB
```

Sizes here are kilobytes to two decimals rather than the rounded figures used
elsewhere. Rounding 5,660 and 3,010 bytes to `6 kB` and `3 kB` defeats the point of
putting them in a column.

Rebuilds gain a tail naming what the cycle did:

```text
  09:43:06 ~ src/layout/container/_container.scss +1 · rebuilt in 2.35s

      40 modules transformed · 2 outputs changed

      file                                                  size     gzip
      global/layout/layout.css                          12.50 kB  2.11 kB
      storybook/components/atoms/textures/cl-textures.css 0.44 kB  0.26 kB
```

This is deliberately not Rolldown's table. Rollup regenerates the whole bundle on
every cycle, so "which files were written" is always "all of them" and answers
nothing. The reporter fingerprints the bundle by content and reports only what
came out different — including the useful negative, `no output changed`, when an
edit compiled to byte-identical CSS. Successful Twig, component metadata, and
static-asset copies are merged into that diff because those files never enter
Rollup's bundle. Files that stopped being written are grouped under
`no longer written`; removals are named even outside verbose mode so a
destructive cycle can never read as though nothing changed.

### What It Costs

Gzip is the only real expense, and it is the whole of Rolldown's
`computing gzip size...` pause. It is spent narrowly: only on compressible
extensions, never on fonts or raster images, and on rebuilds only for the handful
of files that changed. Sourcemaps are omitted before any reporting or gzip work.
Source sizes come from one `stat` per entry at config resolution. The module count
comes from a `transform` hook that is attached only in this mode.

### Why `--verbose` Needs Explaining

npm claims `--verbose` as an alias for `--loglevel verbose`, so it never arrives
as an argument to the script. What it does do is export
`npm_config_loglevel=verbose`, which propagates through `concurrently` into the
`vite` child, and that is what the reporter reads. The side effect is npm's own
`npm verbose` chatter — roughly forty lines per run. `EMULSIFY_VERBOSE=2` exists
because it has none of that.

`EMULSIFY_VERBOSE` wins over the npm log level in both directions, so a project
whose `.npmrc` raises `loglevel` permanently can still pin the reporter down with
`EMULSIFY_VERBOSE=0`.

## Environment Variables

| Variable                           | Effect                                                                                                                                                                                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EMULSIFY_VERBOSE=1`               | Restore Vite's and Rolldown's raw output, including the per-file asset table, Storybook's Sass deprecation blocks, and full dev-server stack traces. Reserved `@assets` resolution notices remain suppressed; unresolved aliases still appear in Core's final diagnostics. |
| `EMULSIFY_VERBOSE=2`               | Detailed reporter. Keeps the reporter in charge and adds the per-file listings described above. Equivalent to `npm run develop --verbose`, without npm's own chatter.                                                                                                      |
| `EMULSIFY_VERBOSE=0`               | Force quiet, overriding a raised npm `loglevel`.                                                                                                                                                                                                                           |
| `EMULSIFY_NO_UNICODE=1`            | Drop the wordmark, the panel rules, and the section rules in favor of plain text. Applied automatically when the terminal's locale is not UTF-8.                                                                                                                           |
| `EMULSIFY_STRICT_ASSETS=1`         | Fail a one-shot build when a CSS asset URL cannot be resolved. Off by default, because an unresolvable URL is occasionally an intentional runtime path.                                                                                                                    |
| `EMULSIFY_STRICT_ASSETS=2`         | Also fail on legacy URLs the build had to repair. First-class `/assets/...` and `@assets/...` references are accepted at this level; `/assets/...` remains the audit autofix output for legacy forms.                                                                      |
| `EMULSIFY_ASSET_REBASE=0`          | Turn the full CSS asset rebase pipeline off for one build, retaining Vite's `dist/assets/` copies and emitted URLs. The permanent switch is `assets.rebase` in `project.emulsify.json`.                                                                                    |
| `EMULSIFY_SELF_CONTAINED_OUTPUT=0` | Opt into lean output for one build: resolved or repaired CSS points at project asset roots, and copies made redundant by those CSS rewrites are removed. Copies needed by JavaScript or other output remain. The permanent switch is `assets.selfContainedOutput`.         |
| `NO_COLOR=1`                       | Disable color. Honors the [no-color.org](https://no-color.org/) convention.                                                                                                                                                                                                |
| `FORCE_COLOR=1`                    | Enable color even when the stream is not a TTY. `develop` pipes through `concurrently`, so this is occasionally useful.                                                                                                                                                    |

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
