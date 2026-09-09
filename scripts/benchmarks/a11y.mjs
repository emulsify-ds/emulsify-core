#!/usr/bin/env node
/**
 * Opt-in, real-browser timing for the accessibility runner in a chosen source tree.
 * Run only in an otherwise idle benchmark window. Every sample uses a fresh Node
 * process; every Pa11y check retains its normal fresh-browser lifecycle.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format, parseArgs } from 'node:util';

const thisScript = fileURLToPath(import.meta.url);
const hashFile = (filePath) =>
  existsSync(filePath)
    ? createHash('sha256').update(readFileSync(filePath)).digest('hex')
    : null;
const positiveInteger = (value, name) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return number;
};

function ensureFixture(fixtureRoot, stories) {
  const ids = Array.from(
    { length: stories },
    (_, index) => `benchmark--${index}`,
  );
  const cards = Array.from(
    { length: 12 },
    (_, index) => `<article><h2>Item ${index + 1}</h2>
<p>A deterministic accessibility benchmark with readable text.</p>
<button type="button">Inspect item ${index + 1}</button></article>`,
  ).join('\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Accessibility benchmark</title>
<style>body{font:16px/1.5 sans-serif;color:#111;background:#fff}button{min-height:32px}article{margin:16px}</style>
</head><body><main id="storybook-root"><h1>Accessibility benchmark</h1>
${cards}</main></body></html>\n`;
  const index = JSON.stringify({
    v: 5,
    entries: Object.fromEntries(
      ids.map((id) => [
        id,
        { id, type: 'story', title: 'Benchmark', name: id },
      ]),
    ),
  });
  mkdirSync(fixtureRoot, { recursive: true });
  for (const [name, source] of [
    ['iframe.html', html],
    ['index.json', index],
  ]) {
    const filePath = join(fixtureRoot, name);
    if (existsSync(filePath) && readFileSync(filePath, 'utf8') !== source) {
      throw new Error(
        `Benchmark fixture differs from the generated fixture: ${filePath}`,
      );
    }
    if (!existsSync(filePath)) writeFileSync(filePath, source);
  }
  return { ids, iframeSha256: hashFile(join(fixtureRoot, 'iframe.html')) };
}

async function loadSource(sourceRoot, browserPath) {
  const sourceRequire = createRequire(join(sourceRoot, 'package.json'));
  const pa11yPath = sourceRequire.resolve('pa11y');
  const pa11yRequire = createRequire(pa11yPath);
  const puppeteer = pa11yRequire('puppeteer');
  const executablePath = resolve(
    browserPath ||
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      (await puppeteer.executablePath()),
  );
  if (!existsSync(executablePath))
    throw new Error(`Browser not found: ${executablePath}`);
  const scriptPath = realpathSync(join(sourceRoot, 'scripts/a11y.js'));
  return {
    pa11y: sourceRequire('pa11y'),
    puppeteer,
    scriptPath,
    executablePath,
    metadata: {
      sourceRoot,
      scriptSha256: hashFile(scriptPath),
      packageLockSha256: hashFile(join(sourceRoot, 'package-lock.json')),
      nodeModulesRoot: realpathSync(join(sourceRoot, 'node_modules')),
      nodeModulesSymlink: lstatSync(
        join(sourceRoot, 'node_modules'),
      ).isSymbolicLink(),
      packageVersion: sourceRequire('./package.json').version,
      pa11y: sourceRequire('pa11y/package.json').version,
      pa11yPuppeteer: pa11yRequire('puppeteer/package.json').version,
      pa11yAxe: pa11yRequire('axe-core/package.json').version,
      pa11yResolvedPath: realpathSync(pa11yPath),
      browserExecutablePath: executablePath,
      browserExecutableRealPath: realpathSync(executablePath),
    },
  };
}

async function importRunner(scriptPath) {
  const originalArgument = process.argv[2];
  process.argv[2] = '--benchmark-import';
  try {
    return await import(pathToFileURL(scriptPath).href);
  } finally {
    process.argv[2] = originalArgument;
  }
}

function supportsConcurrency(runner) {
  try {
    runner.applyProjectA11yConfig({ concurrency: 0 });
    return false;
  } catch (error) {
    if (!/concurrency/i.test(error.message)) throw error;
    runner.applyProjectA11yConfig({ concurrency: 2 });
    return true;
  }
}

function startBrowserMemorySampling(browserPids, intervalMs) {
  const samples = [];
  const errors = new Set();
  const started = performance.now();
  let samplingMs = 0;
  const sample = () => {
    const before = performance.now();
    try {
      const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 2000,
      })
        .trim()
        .split('\n')
        .map((line) => {
          const [pid, parentPid, rssKiB] = line.trim().split(/\s+/).map(Number);
          return { pid, parentPid, rssKiB };
        });
      const descendants = new Set(browserPids);
      let previousSize;
      do {
        previousSize = descendants.size;
        for (const row of rows) {
          if (descendants.has(row.parentPid)) descendants.add(row.pid);
        }
      } while (descendants.size !== previousSize);
      const browserRows = rows.filter(({ pid }) => descendants.has(pid));
      samples.push({
        elapsedMs: performance.now() - started,
        rssKiB: browserRows.reduce((sum, row) => sum + row.rssKiB, 0),
        processes: browserRows.length,
      });
    } catch (error) {
      errors.add(error.message);
    }
    samplingMs += performance.now() - before;
  };
  sample();
  const timer = setInterval(sample, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    sample();
    const observed = samples.some(({ processes }) => processes > 0);
    return {
      available: observed,
      peakRssKiB: observed
        ? Math.max(...samples.map(({ rssKiB }) => rssKiB))
        : null,
      intervalMs,
      samplingMs,
      browserRootPids: [...browserPids],
      samples,
      errors: [...errors],
      scope:
        'Sum of sampled RSS for launched Chromium roots and their current descendants; Node is excluded.',
      caveat:
        'RSS double-counts shared pages and is not PSS. Sampling can miss short-lived or reparented processes and startup before launch resolves.',
    };
  };
}

async function runSample(options) {
  const source = await loadSource(options.sourceRoot, options.browserPath);
  const browserPids = new Set();
  const browsers = new Set();
  const browserVersions = new Set();
  const browserVersionErrors = [];
  const checks = [];
  const pending = new Set();
  let active = 0;
  let peakActiveChecks = 0;
  const launch = source.puppeteer.launch;
  source.puppeteer.launch = async (...args) => {
    const browser = await launch.apply(source.puppeteer, args);
    browsers.add(browser);
    const pid = browser.process()?.pid;
    if (pid) browserPids.add(pid);
    try {
      browserVersions.add(await browser.version());
    } catch (error) {
      browserVersionErrors.push(error.message);
    }
    return browser;
  };
  const measuredPa11y = async (url, config) => {
    const check = {
      storyId: new URL(url).searchParams.get('id'),
      status: 'running',
    };
    checks.push(check);
    active += 1;
    peakActiveChecks = Math.max(peakActiveChecks, active);
    const started = performance.now();
    const promise = source.pa11y(url, config);
    pending.add(promise);
    try {
      const report = await promise;
      Object.assign(check, {
        status: 'completed',
        rawIssues: report.issues.length,
      });
      return report;
    } catch (error) {
      Object.assign(check, {
        status: 'failed',
        error: error.stack || String(error),
      });
      throw error;
    } finally {
      check.totalMs = performance.now() - started;
      active -= 1;
      pending.delete(promise);
    }
  };
  globalThis[Symbol.for('emulsify.a11y.benchmark.pa11y')] = measuredPa11y;
  const proxy =
    'data:text/javascript,' +
    encodeURIComponent(
      'export default globalThis[Symbol.for("emulsify.a11y.benchmark.pa11y")];',
    );
  registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === 'pa11y' &&
        context.parentURL === pathToFileURL(source.scriptPath).href
        ? { url: proxy, shortCircuit: true }
        : nextResolve(specifier, context);
    },
  });
  const runner = await importRunner(source.scriptPath);
  const capSupported = supportsConcurrency(runner);
  runner.applyProjectA11yConfig({
    ...(capSupported ? { concurrency: options.cap } : {}),
    pa11y: {
      timeout: 30000,
      chromeLaunchConfig: {
        executablePath: source.executablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    },
  });
  const server = await runner.startStorybookServer(options.fixtureRoot);
  process.once('SIGTERM', async () => {
    await Promise.allSettled([...browsers].map((browser) => browser.close()));
    await server.close();
    process.exit(143);
  });
  const originalLog = console.log;
  const output = [];
  console.log = (...args) => output.push(format(...args));
  const stopMemory = startBrowserMemorySampling(
    browserPids,
    options.memoryIntervalMs,
  );
  const started = performance.now();
  let runnerReturnedMs;
  let runnerError = null;
  let memory;
  let totalMs;
  try {
    try {
      await runner.lintReportAndExit(options.ids, {
        baseUrl: `${server.baseUrl}/iframe.html`,
      });
    } catch (error) {
      runnerError = error.stack || String(error);
    }
    runnerReturnedMs = performance.now() - started;
    // Older Promise.all runners can reject while real Pa11y checks still run.
    await Promise.allSettled([...pending]);
    totalMs = performance.now() - started;
  } finally {
    memory = stopMemory();
    console.log = originalLog;
    source.puppeteer.launch = launch;
    await Promise.allSettled([...browsers].map((browser) => browser.close()));
    await server.close();
  }
  const reportedExitCode = process.exitCode || 0;
  process.exitCode = 0;
  const counts = {
    cleanReports: output.filter((line) =>
      line.startsWith('No issues found in component:'),
    ).length,
    findingReports: output.filter((line) =>
      line.startsWith('Issues found in component:'),
    ).length,
    failureReports: output.filter((line) =>
      line.startsWith('Execution failed for story:'),
    ).length,
    summaryLines: output.filter((line) =>
      line.startsWith('Accessibility summary:'),
    ).length,
    logCalls: output.length,
  };
  return {
    cap: capSupported ? options.cap : 'unbounded',
    totalMs,
    runnerReturnedMs,
    drainAfterReturnMs: totalMs - runnerReturnedMs,
    peakActiveChecks,
    executionFailures: checks.filter(({ status }) => status === 'failed')
      .length,
    reportedExitCode,
    runnerError,
    checks,
    outputCounts: counts,
    output,
    browserVersions: [...browserVersions],
    browserVersionErrors,
    browserMemory: memory,
    nodeMaxRssKiB: process.resourceUsage().maxRSS,
    activeChecksAtEnd: active,
    complete:
      checks.length === options.ids.length &&
      active === 0 &&
      checks.every(({ status }) => status !== 'running'),
  };
}

export function validateA11ySample(sample, requestedIds) {
  const observedIds = (sample.checks || []).map(({ storyId }) => storyId);
  const storyIdsMatch =
    observedIds.length === requestedIds.length &&
    observedIds.every((id, index) => id === requestedIds[index]);
  const capRespected =
    sample.cap === 'unbounded'
      ? true
      : Number.isFinite(sample.peakActiveChecks)
        ? sample.peakActiveChecks <= sample.cap
        : null;
  const counts = sample.outputCounts;
  const reportedAll = Boolean(
    counts &&
    counts.cleanReports + counts.findingReports + counts.failureReports ===
      requestedIds.length,
  );
  return {
    ...sample,
    requestedIds,
    observedIds,
    storyIdsMatch,
    capRespected,
    reportedAll,
    complete: Boolean(
      sample.complete === true &&
      storyIdsMatch &&
      capRespected &&
      sample.checks.every(({ status }) =>
        ['completed', 'failed'].includes(status),
      ),
    ),
  };
}

export function summarizeSamples(samples, field) {
  const values = samples
    .map((sample) => sample[field])
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return {
    median:
      values.length % 2
        ? values[middle]
        : (values[middle - 1] + values[middle]) / 2,
    min: values[0],
    max: values.at(-1),
  };
}

export function summarizeA11ySamples(raw) {
  return [...new Set(raw.map(({ cap }) => cap))].map((cap) => {
    const rows = raw.filter((sample) => sample.cap === cap);
    const timingRows = rows.filter(
      (row) =>
        row.complete &&
        row.reportedAll &&
        row.executionFailures === 0 &&
        row.reportedExitCode === 0,
    );
    const unknownFailures = rows.filter(
      ({ executionFailures }) => !Number.isInteger(executionFailures),
    ).length;
    const knownFailures = rows.reduce(
      (sum, row) => sum + (row.executionFailures || 0),
      0,
    );
    return {
      cap,
      samples: rows.length,
      completeSamples: rows.filter(({ complete }) => complete).length,
      timingSamples: timingRows.length,
      incompleteSamples: rows.filter(({ complete }) => !complete).length,
      workerFailures: rows.filter(
        (row) =>
          row.workerError || ('workerStatus' in row && row.workerStatus !== 0),
      ).length,
      invalidStoryIdSamples: rows.filter(({ storyIdsMatch }) => !storyIdsMatch)
        .length,
      capViolationSamples: rows.filter(
        ({ capRespected }) => capRespected === false,
      ).length,
      unknownCapSamples: rows.filter(
        ({ capRespected }) => capRespected === null,
      ).length,
      samplesMissingReports: rows.filter(({ reportedAll }) => !reportedAll)
        .length,
      unknownExecutionFailureSamples: unknownFailures,
      knownExecutionFailures: knownFailures,
      executionFailures: unknownFailures ? null : knownFailures,
      totalMs: summarizeSamples(timingRows, 'totalMs'),
      processWallMs: summarizeSamples(timingRows, 'processWallMs'),
      peakActiveChecks: summarizeSamples(timingRows, 'peakActiveChecks'),
      peakBrowserRssKiB: summarizeSamples(
        timingRows.map((row) => ({ value: row.browserMemory?.peakRssKiB })),
        'value',
      ),
    };
  });
}

export async function runA11yBenchmark({
  sourceRoot = process.cwd(),
  fixtureRoot,
  samples = 5,
  stories = 8,
  caps = [1, 2, 4],
  browserPath,
  memoryIntervalMs = 200,
} = {}) {
  sourceRoot = resolve(sourceRoot);
  const temporaryFixture = !fixtureRoot;
  fixtureRoot = fixtureRoot
    ? resolve(fixtureRoot)
    : mkdtempSync(join(tmpdir(), 'emulsify-a11y-benchmark-'));
  try {
    const fixture = ensureFixture(fixtureRoot, stories);
    const source = await loadSource(sourceRoot, browserPath);
    const runner = await importRunner(source.scriptPath);
    const capSupported = supportsConcurrency(runner);
    const modes = capSupported ? caps : [null];
    const raw = [];
    for (let sample = 0; sample < samples; sample += 1) {
      const rotated = [
        ...modes.slice(sample % modes.length),
        ...modes.slice(0, sample % modes.length),
      ];
      for (const cap of rotated) {
        const before = performance.now();
        const result = spawnSync(
          process.execPath,
          [
            thisScript,
            '--sample-worker',
            JSON.stringify({
              sourceRoot,
              fixtureRoot,
              ids: fixture.ids,
              cap,
              browserPath: source.executablePath,
              memoryIntervalMs,
            }),
          ],
          {
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
            timeout: Math.max(120000, stories * 60000),
          },
        );
        const processWallMs = performance.now() - before;
        if (result.error || result.status !== 0) {
          raw.push({
            sample: sample + 1,
            cap: cap ?? 'unbounded',
            processWallMs,
            complete: false,
            workerStatus: result.status,
            workerError: result.error?.message || null,
            stdout: result.stdout,
            stderr: result.stderr,
          });
        } else {
          raw.push({
            sample: sample + 1,
            ...JSON.parse(result.stdout),
            processWallMs,
          });
        }
      }
    }
    const validated = raw.map((sample) =>
      validateA11ySample(sample, fixture.ids),
    );
    return {
      benchmark: 'a11y-real-browser',
      schemaVersion: 1,
      metadata: {
        ...source.metadata,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        systemMemoryBytes: totalmem(),
        capSupported,
      },
      fixture: {
        root: fixtureRoot,
        stories,
        ids: fixture.ids,
        iframeSha256: fixture.iframeSha256,
      },
      methodology: {
        samplesPerMode: samples,
        profiles:
          'Fresh Node worker for every sample, fresh Chromium browser for every real Pa11y check; no synthetic delays or browser reuse.',
        cache:
          'No warmups are discarded. OS and filesystem caches can warm across samples. Cap order rotates between rounds.',
        timing:
          'totalMs covers lintReportAndExit plus draining older early-rejecting runners. processWallMs additionally includes worker startup, imports, server startup and cleanup.',
        dependencies:
          'Dependencies resolve from sourceRoot; nodeModulesRoot and its symlink state identify shared controlled dependency trees.',
        validation:
          'Complete samples require exact requested/observed story IDs, all checks settled, and no cap violation. Timing summaries include only complete samples with all reports, no execution failures, and exit status zero.',
      },
      raw: validated,
      summary: summarizeA11ySamples(validated),
    };
  } finally {
    if (temporaryFixture) rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv[2] === '--sample-worker') {
    console.log(JSON.stringify(await runSample(JSON.parse(process.argv[3]))));
    return;
  }
  const { values } = parseArgs({
    options: {
      'source-root': { type: 'string' },
      'fixture-root': { type: 'string' },
      samples: { type: 'string', default: '5' },
      stories: { type: 'string', default: '8' },
      caps: { type: 'string', default: '1,2,4' },
      'browser-path': { type: 'string' },
      'memory-interval-ms': { type: 'string', default: '200' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: node scripts/benchmarks/a11y.mjs [--source-root PATH] [--fixture-root PATH] [--samples 5] [--stories 8] [--caps 1,2,4] [--browser-path PATH] [--memory-interval-ms 200]\nEmits JSON. Requires an idle benchmark window, installed source dependencies, Chromium, loopback HTTP, and optional ps access for browser RSS.',
    );
    return;
  }
  console.log(
    JSON.stringify(
      await runA11yBenchmark({
        sourceRoot: values['source-root'],
        fixtureRoot: values['fixture-root'],
        samples: positiveInteger(values.samples, 'samples'),
        stories: positiveInteger(values.stories, 'stories'),
        caps: [
          ...new Set(
            values.caps.split(',').map((cap) => positiveInteger(cap, 'cap')),
          ),
        ],
        browserPath: values['browser-path'],
        memoryIntervalMs: positiveInteger(
          values['memory-interval-ms'],
          'memory-interval-ms',
        ),
      }),
      null,
      2,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === thisScript) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}
