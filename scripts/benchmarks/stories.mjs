#!/usr/bin/env node
/**
 * @file Compare story audit revisions with deterministic sources and raw metrics.
 * Fixture modules are read as text by the audit; they are never imported.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fixtureVersion = 1;
const markerName = '.emulsify-story-benchmark.json';
const extensions = ['js', 'ts', 'jsx', 'tsx'];
const cases = [
  'modern',
  'direct-legacy',
  'shared-modern-only',
  'shared-modern-and-legacy',
  'inherited-metadata-render',
  'overridden-metadata-render',
  'excluded-legacy-export',
  'lexically-shadowed-template',
];

const hash = (value) => createHash('sha256').update(value).digest('hex');

function parseOptions(argv) {
  const options = { samples: 5, stories: 800, mode: 'all' };
  const keys = {
    '--source-root': 'sourceRoot',
    '--fixture-root': 'fixtureRoot',
    '--samples': 'samples',
    '--stories': 'stories',
    '--mode': 'mode',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = keys[argv[index]];
    if (!key || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error(`Unknown or incomplete option: ${argv[index]}`);
    }
    options[key] = argv[index + 1];
    index += 1;
  }
  for (const key of ['samples', 'stories']) {
    options[key] = Number(options[key]);
    if (!Number.isSafeInteger(options[key]) || options[key] < 1) {
      throw new Error(`${key} must be a positive integer.`);
    }
  }
  if (!options.sourceRoot || !options.fixtureRoot) {
    throw new Error('--source-root and --fixture-root are required.');
  }
  if (!['all', 'prepare', 'counts'].includes(options.mode)) {
    throw new Error('--mode must be all, prepare, or counts.');
  }
  options.sourceRoot = resolve(options.sourceRoot);
  options.fixtureRoot = resolve(options.fixtureRoot);
  return options;
}

function storySource(index, extension) {
  const typed = extension === 'ts' || extension === 'tsx';
  const args = typed ? 'args: Args' : 'args';
  const kind = Math.floor(index / extensions.length) % cases.length;
  const lines = [
    'import cardTwig from "../../bench-template.twig";',
    'import { renderTwig } from "@emulsify/core/storybook";',
    ...(typed ? ['type Args = { label: string; enabled?: boolean };'] : []),
    `const content = { label: "Seed 31445 / story ${index}", enabled: true };`,
    `function mapArgs(${args}) { const { label } = args; return { ...args, label }; }`,
    ...(['jsx', 'tsx'].includes(extension)
      ? [
          'const Preview = () => <section data-fixture="story"><span>Preview</span></section>;',
        ]
      : []),
  ];
  let metadata = `{ title: "Benchmark/Story${index}" }`;
  let exports;
  switch (kind) {
    case 0:
      exports = [
        'export const Modern = { render: renderTwig(cardTwig, { context: mapArgs }), args: content };',
      ];
      break;
    case 1:
      exports = [`export const Legacy = (${args}) => cardTwig(mapArgs(args));`];
      break;
    case 2:
    case 3:
      lines.push(`const Template = (${args}) => cardTwig(mapArgs(args));`);
      exports = [
        'export const Modern = { render: renderTwig(Template), args: content };',
      ];
      if (kind === 3) exports.push('export const Legacy = Template.bind({});');
      break;
    case 4:
    case 5:
      metadata = `{ title: "Benchmark/Story${index}", render: (${args}) => cardTwig(mapArgs(args)) }`;
      exports = [
        kind === 4
          ? 'export const Inherited = { args: content };'
          : 'export const Overridden = { render: renderTwig(cardTwig), args: content };',
      ];
      break;
    case 6:
      metadata = `{ title: "Benchmark/Story${index}", includeStories: /^Visible/, excludeStories: ["Legacy"] }`;
      exports = [
        `export const Legacy = (${args}) => cardTwig(mapArgs(args));`,
        'export const Visible = { render: renderTwig(cardTwig), args: content };',
      ];
      break;
    default:
      exports = [
        'export const Shadowed = () => {',
        '  const cardTwig = () => "local HTML";',
        '  return cardTwig();',
        '};',
      ];
  }
  lines.push(
    `const metadata = ${metadata};`,
    `export default ${typed ? 'metadata satisfies Record<string, unknown>' : 'metadata'};`,
    ...exports,
    '',
  );
  return { source: lines.join('\n'), kind: cases[kind] };
}

export function prepareStoryFixture({ fixtureRoot, stories }) {
  const marker = resolve(fixtureRoot, markerName);
  if (existsSync(marker)) {
    const existing = JSON.parse(readFileSync(marker, 'utf8'));
    if (
      existing.fixtureVersion !== fixtureVersion ||
      existing.stories !== stories
    ) {
      throw new Error(
        'Existing benchmark fixture has a different version or story count.',
      );
    }
  } else if (existsSync(fixtureRoot) && readdirSync(fixtureRoot).length) {
    throw new Error(
      'Fixture root must be empty or belong to this story benchmark.',
    );
  }
  mkdirSync(fixtureRoot, { recursive: true });
  const manifest = {
    fixtureVersion,
    seed: 31445,
    stories,
    extensions: Object.fromEntries(
      extensions.map((extension) => [extension, 0]),
    ),
    cases: Object.fromEntries(cases.map((name) => [name, 0])),
    sourceBytes: 0,
  };
  const fixtureHash = createHash('sha256');
  const write = (file, source) => {
    const target = resolve(fixtureRoot, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
    fixtureHash.update(`${file}\0${source}\0`);
  };
  write(
    'project.emulsify.json',
    JSON.stringify(
      {
        project: {
          platform: 'none',
          name: 'story-benchmark',
          machineName: 'story_benchmark',
        },
      },
      null,
      2,
    ),
  );
  write(
    'package.json',
    JSON.stringify(
      { name: 'emulsify-story-benchmark', private: true, type: 'module' },
      null,
      2,
    ),
  );
  write(
    'src/components/bench-template.twig',
    '<article>{{ label }}</article>\n',
  );
  for (let index = 0; index < stories; index += 1) {
    const extension = extensions[index % extensions.length];
    const id = String(index).padStart(5, '0');
    const { source, kind } = storySource(index, extension);
    write(
      `src/components/group-${index % 10}/story-${id}/story-${id}.stories.${extension}`,
      source,
    );
    manifest.extensions[extension] += 1;
    manifest.cases[kind] += 1;
    manifest.sourceBytes += Buffer.byteLength(source);
  }
  manifest.sha256 = fixtureHash.digest('hex');
  writeFileSync(marker, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function summarizeResult(result, fixtureRoot) {
  if (!Array.isArray(result?.findings) || result.error) {
    throw new Error(
      `Audit returned an invalid or failed report: ${JSON.stringify(result)}`,
    );
  }
  const byId = {};
  const findings = result.findings.map((finding) => {
    const id = finding.id || 'legacy-twig-story';
    byId[id] = (byId[id] || 0) + 1;
    const file = finding.filePath || finding.path || finding.file || '';
    return {
      id,
      severity: finding.severity || 'warn',
      file: (isAbsolute(file) ? relative(fixtureRoot, file) : file).replaceAll(
        '\\',
        '/',
      ),
      line: finding.line || finding.directTemplateReturns?.[0]?.line || null,
      details: finding.details || finding.reasons || [],
    };
  });
  findings.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'),
  );
  return {
    findingCount: findings.length,
    findingsHash: hash(JSON.stringify(findings)),
    byId,
    storyCount: Array.isArray(result.files)
      ? result.files.length
      : result.files?.stories,
  };
}

function runCold(options, command) {
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [
      resolve(options.sourceRoot, 'scripts', command),
      '--root',
      options.fixtureRoot,
      '--json',
    ],
    { cwd: options.sourceRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const elapsedMs = performance.now() - started;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Audit CLI exited ${result.status}: ${result.stderr}\n${result.stdout}`,
    );
  }
  return {
    elapsedMs,
    exitCode: result.status,
    stdoutBytes: Buffer.byteLength(result.stdout),
    stderrBytes: Buffer.byteLength(result.stderr),
    stderr: result.stderr,
    ...summarizeResult(JSON.parse(result.stdout), options.fixtureRoot),
  };
}

async function loadAudits(sourceRoot) {
  const combined = await import(
    pathToFileURL(resolve(sourceRoot, 'scripts/audit/index.js')).href
  );
  const standalone = await import(
    pathToFileURL(resolve(sourceRoot, 'scripts/audit-twig-stories.js')).href
  );
  return {
    combined: combined.runAudits,
    standalone: standalone.auditTwigStories,
  };
}

async function parseCounts(options) {
  // Patch the declared CJS dependency before the audit's ESM imports capture it.
  // This worker performs no timing and never loads a fixture story as a module.
  const require = createRequire(resolve(options.sourceRoot, 'package.json'));
  const parser = require('@babel/parser');
  const originalParse = parser.parse;
  let counts = { calls: 0, byPlugins: {} };
  parser.parse = function countedParse(source, parserOptions) {
    counts.calls += 1;
    const plugins = (parserOptions?.plugins || []).join(',');
    counts.byPlugins[plugins] = (counts.byPlugins[plugins] || 0) + 1;
    return originalParse.call(this, source, parserOptions);
  };
  try {
    const audits = await loadAudits(options.sourceRoot);
    const results = {};
    for (const [name, audit] of Object.entries(audits)) {
      counts = { calls: 0, byPlugins: {} };
      const result = audit({ projectDir: options.fixtureRoot });
      results[name] = {
        ...counts,
        ...summarizeResult(result, options.fixtureRoot),
      };
    }
    return results;
  } finally {
    parser.parse = originalParse;
  }
}

export async function runStoryBenchmark(options) {
  const fixture = prepareStoryFixture(options);
  const metadata = {
    schemaVersion: 1,
    benchmark: 'story-audits',
    node: process.version,
    nodeExecutable: process.execPath,
    platform: process.platform,
    arch: process.arch,
    sourceRoot: options.sourceRoot,
    fixtureRoot: options.fixtureRoot,
    fixture,
  };
  if (options.mode === 'prepare') return metadata;
  if (options.mode === 'counts')
    return { ...metadata, parseCounts: await parseCounts(options) };

  const cold = { combined: [], standalone: [] };
  for (let index = 0; index < options.samples; index += 1) {
    cold.combined.push(runCold(options, 'audit.js'));
    cold.standalone.push(runCold(options, 'audit-twig-stories.js'));
  }
  const warm = {};
  const audits = await loadAudits(options.sourceRoot);
  for (const [name, audit] of Object.entries(audits)) {
    const priming = summarizeResult(
      audit({ projectDir: options.fixtureRoot }),
      options.fixtureRoot,
    );
    const samples = [];
    for (let index = 0; index < options.samples; index += 1) {
      const started = performance.now();
      const result = audit({ projectDir: options.fixtureRoot });
      const elapsedMs = performance.now() - started;
      samples.push({
        elapsedMs,
        ...summarizeResult(result, options.fixtureRoot),
      });
    }
    warm[name] = { priming, samples };
  }
  const counts = spawnSync(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      '--source-root',
      options.sourceRoot,
      '--fixture-root',
      options.fixtureRoot,
      '--stories',
      String(options.stories),
      '--mode',
      'counts',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (counts.error) throw counts.error;
  if (counts.status !== 0)
    throw new Error(
      `Parser-count worker failed: ${counts.stderr}\n${counts.stdout}`,
    );
  const measuredParseCounts = JSON.parse(counts.stdout).parseCounts;
  for (const name of ['combined', 'standalone']) {
    const results = [
      ...cold[name],
      warm[name].priming,
      ...warm[name].samples,
      measuredParseCounts[name],
    ];
    if (results.some((result) => result.storyCount !== options.stories)) {
      throw new Error(`${name} did not scan every generated story.`);
    }
    if (new Set(results.map((result) => result.findingsHash)).size !== 1) {
      throw new Error(
        `${name} produced inconsistent findings across CLI, warm, or parser-count runs.`,
      );
    }
  }
  return {
    ...metadata,
    samples: options.samples,
    cold,
    warm,
    parseCounts: measuredParseCounts,
    limitations: [
      'Cold means a fresh Node process, not a cleared operating-system filesystem cache.',
      'Fixture creation happens before timing and writes every source file, warming filesystem caches.',
      'Warm samples exclude module imports and one priming audit; they retain V8/module/filesystem warmth.',
      'Combined audits reset their file-read cache each pass; standalone audits read every story each pass.',
      'Cold timings include CLI formatting and process startup; warm timings include API work only.',
      'Parser instrumentation runs separately from all timing samples. Base regex analyzers may report zero parses.',
      'Different revisions may intentionally produce different findings; compare hashes within a revision before comparing timing.',
      'The benchmark does not build Storybook, launch a browser, or evaluate consumer story modules.',
    ],
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(
      JSON.stringify(
        await runStoryBenchmark(parseOptions(process.argv.slice(2))),
      ),
    );
  } catch (error) {
    console.log(JSON.stringify({ error: error.message, stack: error.stack }));
    process.exitCode = 1;
  }
}
