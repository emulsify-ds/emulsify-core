#!/usr/bin/env node
/**
 * @file Opt-in grouped resolver benchmark. Timing and instrumentation run separately.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultSourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const positiveInteger = (value, name) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
};

function prepareFixture(fixtureRoot, groups, depth, extraFiles = []) {
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const marker = path.join(fixtureRoot, '.resolver-benchmark.json');
  const dimensions = { version: 1, groups, depth };
  if (fs.existsSync(marker)) {
    assert.deepEqual(JSON.parse(fs.readFileSync(marker, 'utf8')), dimensions);
  } else {
    assert.equal(
      fs.readdirSync(fixtureRoot).length,
      0,
      'Fixture directory must be empty or belong to this benchmark',
    );
    fs.writeFileSync(marker, JSON.stringify(dimensions));
  }

  const componentRoot = path.join(fixtureRoot, 'src/components');
  const groupPaths = [];
  for (let group = 0; group < groups; group += 1) {
    let directory = path.join(
      componentRoot,
      `group-${String(group).padStart(4, '0')}`,
    );
    const chain = [directory];
    for (let level = 1; level < depth; level += 1) {
      directory = path.join(directory, `level-${level}`);
      chain.push(directory);
    }
    fs.mkdirSync(directory, { recursive: true });
    groupPaths.push(chain);
  }
  const early = path.join(groupPaths[0][0], 'early.twig');
  const lastDirectory = groupPaths.at(-1).at(-1);
  const late = path.join(lastDirectory, 'late.twig');
  const files = new Map([
    [early, '<p>First matching component</p>\n'],
    [late, '<p>Last matching component</p>\n'],
  ]);
  const duplicate = path.join(lastDirectory, 'early.twig');
  if (duplicate !== early) {
    files.set(duplicate, '<p>Later duplicate must not win</p>\n');
  }
  for (const [relative, contents] of extraFiles) {
    files.set(path.join(fixtureRoot, relative), contents);
  }
  for (const [file, contents] of files) fs.writeFileSync(file, contents);

  const manifest = [];
  const visit = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      const relative = path
        .relative(fixtureRoot, file)
        .split(path.sep)
        .join('/');
      if (entry.isDirectory()) {
        manifest.push([relative, 'directory']);
        visit(file);
      } else {
        manifest.push([relative, sha256(fs.readFileSync(file))]);
      }
    }
  };
  visit(fixtureRoot);
  return {
    componentRoot,
    early,
    late,
    metadata: {
      root: fixtureRoot,
      ...dimensions,
      groupingDirectories: groups * depth,
      files: files.size,
      manifestEntries: manifest.length,
      sha256: sha256(JSON.stringify(manifest)),
    },
  };
}

function benchmarkAuditCli(options, groups, depth, repetitions, samples) {
  const fixtureRoot = `${options.fixtureRoot}-audit`;
  const references = Array.from({ length: repetitions }, () =>
    ['early', 'late', 'missing']
      .map((name) => `{{ include('test_theme:${name}', {}, false) }}`)
      .join('\n'),
  ).join('\n');
  const fixture = prepareFixture(fixtureRoot, groups, depth, [
    [
      'project.emulsify.json',
      JSON.stringify({
        project: {
          platform: 'drupal',
          machineName: 'test_theme',
          singleDirectoryComponents: true,
        },
      }),
    ],
    ['src/components/references.twig', `${references}\n`],
  ]);
  const run = (timed) => {
    const started = timed ? performance.now() : null;
    const child = spawnSync(
      process.execPath,
      [
        path.join(options.sourceRoot, 'scripts/audit.js'),
        '--root',
        fixtureRoot,
        '--json',
      ],
      {
        cwd: options.sourceRoot,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    const milliseconds = timed ? performance.now() - started : null;
    if (child.error) throw child.error;
    assert.equal(
      child.status,
      0,
      `Audit CLI failed: ${child.stderr}\n${child.stdout}`,
    );
    const report = JSON.parse(child.stdout);
    assert.ok(Array.isArray(report.findings), 'Audit CLI must return findings');
    const canonical = JSON.stringify(report.findings).replaceAll(
      fixtureRoot,
      '<fixture>',
    );
    const findingsById = {};
    for (const finding of report.findings) {
      findingsById[finding.id] = (findingsById[finding.id] || 0) + 1;
    }
    return {
      milliseconds,
      exitCode: child.status,
      findingCount: report.findings.length,
      findingsById,
      findingsSha256: sha256(canonical),
      stderr: child.stderr,
    };
  };
  const verification = run(false);
  const timedSamples = [];
  if (!options.countsOnly) {
    for (let sample = 0; sample < samples; sample += 1) {
      const result = run(true);
      assert.equal(result.findingsSha256, verification.findingsSha256);
      timedSamples.push(result);
    }
  }
  return {
    fixture: fixture.metadata,
    references: repetitions * 3,
    policy:
      'Actual combined audit CLI in a fresh process per sample; includes startup, project scanning, checks, and JSON reporting. Verification is untimed.',
    verification,
    samples: timedSamples,
  };
}

function instrument(run, componentRoot) {
  const counts = {
    statSync: 0,
    realpathSync: 0,
    readdirSync: 0,
    existsSync: 0,
    pathResolve: 0,
    groupedFlatMapArrays: 0,
    groupedFlatMapEntries: 0,
  };
  const originalFs = Object.fromEntries(
    ['statSync', 'realpathSync', 'readdirSync', 'existsSync'].map((name) => [
      name,
      fs[name],
    ]),
  );
  const originalResolve = path.resolve;
  const originalFlatMap = Array.prototype.flatMap;
  for (const [name, original] of Object.entries(originalFs)) {
    fs[name] = function (...args) {
      counts[name] += 1;
      return original.apply(this, args);
    };
    Object.assign(fs[name], original);
  }
  path.resolve = function (...args) {
    counts.pathResolve += 1;
    return originalResolve.apply(this, args);
  };
  Array.prototype.flatMap = function (...args) {
    const result = originalFlatMap.apply(this, args);
    const isComponentPath = (value) =>
      typeof value === 'string' &&
      value.startsWith(`${componentRoot}${path.sep}`);
    if (
      this.length &&
      this.every(isComponentPath) &&
      result.length &&
      result.every(isComponentPath)
    ) {
      counts.groupedFlatMapArrays += 1;
      counts.groupedFlatMapEntries += result.length;
    }
    return result;
  };
  syncBuiltinESMExports();
  try {
    return { counts, result: run() };
  } finally {
    Object.assign(fs, originalFs);
    path.resolve = originalResolve;
    Array.prototype.flatMap = originalFlatMap;
    syncBuiltinESMExports();
  }
}

/** Run against a prepared source tree; each sample owns a fresh directory cache. */
export async function runResolverBenchmark(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || defaultSourceRoot);
  const fixtureRoot = path.resolve(
    options.fixtureRoot ||
      fs.mkdtempSync(path.join(tmpdir(), 'emulsify-resolver-')),
  );
  const groups = positiveInteger(options.groups ?? 40, 'groups');
  const depth = positiveInteger(options.depth ?? 3, 'depth');
  const repetitions = positiveInteger(
    options.repetitions ?? 100,
    'repetitions',
  );
  const samples = positiveInteger(options.samples ?? 7, 'samples');
  const fixture = prepareFixture(fixtureRoot, groups, depth);
  const sharedModule = path.join(
    sourceRoot,
    'config/vite/utils/twig-component-resolver.js',
  );
  const sharedAvailable = fs.existsSync(sharedModule);
  let resolveReference;
  if (sharedAvailable) {
    const { resolveComponentReference } = await import(
      pathToFileURL(sharedModule)
    );
    resolveReference = (reference, cache) =>
      resolveComponentReference(
        reference,
        { components: fixture.componentRoot },
        cache,
      );
  } else {
    const { resolvesTwigReference } = await import(
      pathToFileURL(path.join(sourceRoot, 'scripts/audit/lib/twig.js'))
    );
    const env = {
      projectDir: fixtureRoot,
      machineName: 'test_theme',
      SDC: true,
      singleDirectoryComponents: true,
      namespaceRoots: { components: fixture.componentRoot },
      componentRoots: [fixture.componentRoot],
    };
    resolveReference = (reference, cache) =>
      resolvesTwigReference(
        reference,
        path.join(fixtureRoot, 'probe.twig'),
        env,
        cache,
      );
  }

  const cases = [
    { name: 'early', reference: 'test_theme:early', expected: fixture.early },
    { name: 'late', reference: 'test_theme:late', expected: fixture.late },
    { name: 'missing', reference: 'test_theme:missing', expected: null },
  ];
  const normalize = (value) =>
    typeof value === 'string'
      ? path.relative(fixtureRoot, value).split(path.sep).join('/')
      : value;
  const results = [];
  for (const entry of cases) {
    const actual = resolveReference(entry.reference, new Map());
    if (sharedAvailable) assert.equal(actual, entry.expected, entry.name);
    const run = (measurePhases = false) => {
      const cache = new Map();
      let lastResult;
      let resolved = 0;
      const coldStart = measurePhases ? performance.now() : null;
      let coldEnd;
      for (let iteration = 0; iteration < repetitions; iteration += 1) {
        lastResult = resolveReference(entry.reference, cache);
        if (lastResult) resolved += 1;
        if (measurePhases && iteration === 0) coldEnd = performance.now();
      }
      const phases = measurePhases
        ? {
            coldMilliseconds: coldEnd - coldStart,
            warmMilliseconds: performance.now() - coldEnd,
          }
        : undefined;
      return {
        resolved,
        unresolved: repetitions - resolved,
        lastResult,
        ...(phases && { phases }),
      };
    };

    const sampleMilliseconds = [];
    const coldFirstLookupMilliseconds = [];
    const warmRemainingLookupMilliseconds = [];
    if (!options.countsOnly) {
      run(); // One full untimed warmup pass, with the same fresh-cache policy.
      for (let sample = 0; sample < samples; sample += 1) {
        const started = performance.now();
        const { phases } = run(true);
        sampleMilliseconds.push(performance.now() - started);
        coldFirstLookupMilliseconds.push(phases.coldMilliseconds);
        warmRemainingLookupMilliseconds.push(phases.warmMilliseconds);
      }
    }
    // Builtin patches count calls in a separate pass, never inside timed samples.
    const { counts, result } = instrument(run, fixture.componentRoot);
    const sorted = [...sampleMilliseconds].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const medianMilliseconds = sorted.length
      ? sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2
      : null;
    results.push({
      name: entry.name,
      reference: entry.reference,
      expectedTarget: normalize(entry.expected),
      actual: normalize(actual),
      matchesExpectedExistence: Boolean(actual) === Boolean(entry.expected),
      outcome: { ...result, lastResult: normalize(result.lastResult) },
      timing: {
        sampleMilliseconds,
        medianMilliseconds,
        coldFirstLookupMilliseconds,
        warmRemainingLookupMilliseconds,
        warmLookupsPerSample: repetitions - 1,
      },
      instrumentation: counts,
    });
  }
  return {
    benchmark: 'grouped-component-resolver',
    sourceRoot,
    node: process.version,
    api: sharedAvailable
      ? 'resolveComponentReference'
      : 'resolvesTwigReference',
    comparable: sharedAvailable,
    note: sharedAvailable
      ? 'Shared resolver microbenchmark; target paths are verified, including duplicate precedence.'
      : 'Shared grouped resolver unavailable: public audit boolean fallback. Grouped support and outcomes may differ; timings are not equivalent work.',
    fixture: fixture.metadata,
    repetitions,
    samples: options.countsOnly ? 0 : samples,
    warmupPassesPerCase: options.countsOnly ? 0 : 1,
    cachePolicy:
      'Fresh grouping-directory Map per pass, reused across repetitions. OS filesystem caches are warm and are not flushed. No runtime-plugin resolution LRU is used.',
    instrumentationPolicy:
      'Separate untimed pass. Filesystem/path counters include all synchronous calls during lookup. Allocation counters measure flattened grouped candidate arrays/entries only, not all allocations.',
    outcomeSha256: sha256(
      JSON.stringify(
        results.map(({ name, actual, outcome }) => ({ name, actual, outcome })),
      ),
    ),
    cases: results,
    auditCli: benchmarkAuditCli(
      { ...options, sourceRoot, fixtureRoot },
      groups,
      depth,
      repetitions,
      samples,
    ),
  };
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2);
  const options = {};
  const names = {
    '--source-root': 'sourceRoot',
    '--fixture-root': 'fixtureRoot',
    '--samples': 'samples',
    '--repetitions': 'repetitions',
    '--groups': 'groups',
    '--depth': 'depth',
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--counts-only') options.countsOnly = true;
    else if (
      names[flag] &&
      args[index + 1] &&
      !args[index + 1].startsWith('--')
    ) {
      index += 1;
      options[names[flag]] = args[index];
    } else throw new Error(`Unknown option or missing value: ${flag}`);
  }
  console.log(JSON.stringify(await runResolverBenchmark(options), null, 2));
}
