/**
 * @file Actual accessibility CLI reporting and server cleanup with mixed outcomes.
 */

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('accessibility CLI cleanup', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'emulsify-a11y-cli-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('reports every outcome and naturally exits nonzero after all checks finish', () => {
    const names = [
      'failed-check',
      'valid-issues',
      'delayed-clean',
      'last-clean',
    ];
    const tracePath = join(projectDir, 'checks.jsonl');
    const hookPath = join(projectDir, 'mock-pa11y-hook.mjs');
    const mockPath = join(projectDir, 'mock-pa11y.mjs');
    const configDir = join(projectDir, 'config/emulsify-core');
    const buildDir = join(projectDir, '.out');
    mkdirSync(configDir, { recursive: true });
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(join(projectDir, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(buildDir, 'iframe.html'), 'Storybook remains available');
    writeFileSync(
      join(configDir, 'a11y.config.js'),
      `export default ${JSON.stringify({
        concurrency: 2,
        discoverStories: false,
        components: names,
        storybookBuildDir: '.out',
      })};\n`,
    );
    writeFileSync(
      hookPath,
      `import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === 'pa11y'
      ? { url: pathToFileURL(${JSON.stringify(mockPath)}).href, shortCircuit: true }
      : nextResolve(specifier, context);
  },
});\n`,
    );
    writeFileSync(
      mockPath,
      `import { appendFileSync } from 'node:fs';
import { get } from 'node:http';
import { setTimeout } from 'node:timers/promises';
const record = (event, id) => appendFileSync(
  process.env.A11Y_CLI_TRACE,
  JSON.stringify({ event, id }) + '\\n',
);
const readPage = (url) => new Promise((resolve, reject) => {
  get(url, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => resolve(body));
    response.on('error', reject);
  }).on('error', reject);
});
export default async function pa11y(pageUrl) {
  const id = new URL(pageUrl).searchParams.get('id');
  record('started', id);
  try {
    if (id === 'failed-check') throw new Error('Fixture browser failed');
    await setTimeout(id === 'delayed-clean' ? 40 : 0);
    if (await readPage(pageUrl) !== 'Storybook remains available') {
      throw new Error('Storybook closed before checks settled');
    }
    record('server-available', id);
    return {
      pageUrl,
      issues: id === 'valid-issues' ? [{
        code: 'fixture-rule',
        type: 'error',
        message: 'Fixture accessibility issue',
        context: '<button></button>',
        selector: 'button',
        runnerExtras: {},
      }] : [],
    };
  } finally {
    record('settled', id);
  }
}\n`,
    );

    const result = spawnSync(
      process.execPath,
      ['--import', hookPath, join(process.cwd(), 'scripts/a11y.js'), '-r'],
      {
        cwd: projectDir,
        env: { ...process.env, A11Y_CLI_TRACE: tracePath },
        encoding: 'utf8',
        timeout: 10_000,
      },
    );

    // A leaked listening server keeps this process alive until the timeout.
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('AggregateError');
    const events = readFileSync(tracePath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(
      events.filter(({ event }) => event === 'started').map(({ id }) => id),
    ).toEqual(names);
    expect(
      events
        .filter(({ event }) => event === 'settled')
        .map(({ id }) => id)
        .sort(),
    ).toEqual([...names].sort());
    expect(
      events
        .filter(({ event }) => event === 'server-available')
        .map(({ id }) => id)
        .sort(),
    ).toEqual(names.slice(1).sort());
    const reportOrder = names.map((name) => result.stdout.indexOf(name));
    expect(reportOrder.every((position) => position >= 0)).toBe(true);
    expect(reportOrder).toEqual(
      [...reportOrder].sort((left, right) => left - right),
    );
    expect(result.stdout).toContain('Execution failed for story: failed-check');
    expect(result.stdout).toContain('Fixture browser failed');
    expect(result.stdout).toContain('Fixture accessibility issue');
    expect(result.stdout).toContain(
      'Accessibility summary: 4 attempted, 2 clean, 1 with findings, 1 failed to execute.',
    );
  });
});
