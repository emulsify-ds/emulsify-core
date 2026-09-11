# Opt-in developer workload benchmarks

These scripts measure story audits, grouped Twig resolution, and real Pa11y
browser scans. They are not part of `npm test` and enforce no wall-clock budgets.
Run them sequentially on an otherwise idle machine. Each script emits JSON with
raw samples, fixture fingerprints, outcomes, and its cache policy.

## Prepare isolated revisions

Install the checkout's dependencies first, then prepare source archives:

```sh
node scripts/benchmarks/prepare.mjs \
  --base a0c08cf1e409138ffd008a882394e5c2001e5bef \
  --head HEAD \
  --output-dir /tmp/emulsify-perf-run
```

The output directory must not exist. The script records the resolved commit
SHAs and environment in `metadata.json`, creates `base` and `head` source
directories, and points both at the checkout's `node_modules`. It leaves the
checkout and Git index untouched. Neither archive contains generated `dist` or
Storybook output. `--head working-tree` additionally applies tracked changes and
records their patch digest; untracked files are excluded.

This is a **source implementation comparison with controlled dependencies**,
not a complete release comparison including dependency changes. Record the
dependency lockfile digest as well as both source SHAs. To investigate dependency
effects separately, prepare independent installations from each revision's
lockfile and pass those source roots directly to the workload scripts.

## Run the workloads

Use the same fixture directories and options for both revisions:

```sh
for revision in base head; do
  node scripts/benchmarks/stories.mjs \
    --source-root "/tmp/emulsify-perf-run/$revision" \
    --fixture-root /tmp/emulsify-perf-run/fixtures/stories \
    --stories 800 --samples 5 \
    > "/tmp/emulsify-perf-run/stories-$revision.json"

  node scripts/benchmarks/resolver.mjs \
    --source-root "/tmp/emulsify-perf-run/$revision" \
    --fixture-root /tmp/emulsify-perf-run/fixtures/resolver \
    --groups 40 --depth 3 --repetitions 100 --samples 7 \
    > "/tmp/emulsify-perf-run/resolver-$revision.json"

  node scripts/benchmarks/a11y.mjs \
    --source-root "/tmp/emulsify-perf-run/$revision" \
    --fixture-root /tmp/emulsify-perf-run/fixtures/a11y \
    --browser-path /absolute/path/to/chromium \
    --stories 8 --samples 5 --caps 1,2,4 \
    > "/tmp/emulsify-perf-run/a11y-$revision.json"
done
```

The accessibility workload requires Chromium and permission to bind loopback
HTTP and launch browsers. Optional `ps` access measures the launched browser
process trees. It uses a deterministic, prewritten iframe instead of rebuilding
Storybook; all selected IDs scan the same content. It measures browser startup,
navigation, scanning, and reporting, not Storybook application rendering.
Older runners that do not support a cap are labeled `unbounded` and run once per
sample, rather than being presented as supporting caps they ignore.

## Interpret the results

- Compare medians and variation across all samples, retaining failed samples.
  Do not select the fastest run. Report repeated batches if scheduler or thermal
  noise is large. The accessibility script rotates cap order between rounds.
- Story `cold` samples run the actual audit CLIs in fresh Node processes. `warm`
  samples call the audit APIs after module loading and a priming pass. These
  measure different boundaries; their difference is not solely a cache benefit.
- Resolver samples separate the first lookup with a fresh grouping-directory
  cache from subsequent warm lookups and retain the whole-pass total. `auditCli`
  measures the combined audit command against a sibling `<fixture-root>-audit`
  fixture with equal numbers of repeated early, late, and missing references.
- OS filesystem caches are not flushed. Fixture preparation warms files before
  timing. An application cache reset is not a cold-disk benchmark.
- Parser, filesystem, path-construction, and grouped-array counters run in
  separate untimed passes. They describe work performed, not heap usage.
- Compare findings hashes and resolved paths before claiming equivalent work.
  A revision that omits findings or cannot resolve grouped components may be
  faster while doing less correct work. The resolver explicitly flags the
  pre-shared-resolver API as noncomparable.
- Browser memory is the sampled sum of RSS across launched Chromium roots and
  descendants, excluding Node. It can double-count shared pages and miss brief
  peaks or reparented processes. It is not PSS or a universal memory estimate.
  Memory sampling has overhead, which is recorded with each sample.
- Neither audit timings nor concurrency limits demonstrate a general Storybook
  or production-build speedup. Keep the accessibility default unchanged unless
  broader resource and reliability evidence supports changing it.

The generated fixtures are benchmark-owned and reject incompatible existing
contents. Keep the output directory to inspect or compare raw samples; remove
that directory when finished.
