/**
 * @file Revision identity, partial failures, privacy, and command-equivalence tests.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  finalize,
  initialize,
  releaseChecks,
  runCheck,
  runCli,
  verify,
} from './release-evidence.js';
import {
  collectDetails,
  createEvidence,
  evidencePath,
  finishEvidence,
  jestCounts,
  readJson,
  recordBrowserEvidence,
  recordFixtureOutcome,
  recordFixturePlan,
  recordTarballEvidence,
  sourceSnapshot,
  writeEvidence,
} from './lib/release-evidence.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const nodeCommand = (source) => [process.execPath, '-e', source];
const posixIt = process.platform === 'win32' ? it.skip : it;

describe('internal release evidence', () => {
  let cwd;
  let originalPath;
  let originalEvents;
  let originalActions;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'emulsify-evidence-test-'));
    originalPath = process.env.PATH;
    originalEvents = process.env.EMULSIFY_RELEASE_EVIDENCE_EVENTS;
    originalActions = process.env.GITHUB_ACTIONS;
    delete process.env.EMULSIFY_RELEASE_EVIDENCE_EVENTS;
    delete process.env.GITHUB_ACTIONS;
    git(cwd, ['init', '--initial-branch=fixture']);
    git(cwd, ['config', 'user.name', 'Evidence Test']);
    git(cwd, ['config', 'user.email', 'evidence@example.com']);
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({ name: 'evidence-fixture', version: '1.0.0' }),
    );
    writeFileSync(join(cwd, 'package-lock.json'), '{}\n');
    writeFileSync(join(cwd, '.gitignore'), '.release-evidence\n');
    writeFileSync(join(cwd, 'tracked.txt'), 'original\n');
    git(cwd, ['add', '.']);
    git(cwd, ['commit', '-m', 'chore: create evidence fixture']);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    if (originalEvents === undefined)
      delete process.env.EMULSIFY_RELEASE_EVIDENCE_EVENTS;
    else process.env.EMULSIFY_RELEASE_EVIDENCE_EVENTS = originalEvents;
    if (originalActions === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = originalActions;
    jest.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('binds clean and dirty tracked inputs without copying paths or content', () => {
    const before = sourceSnapshot(cwd);
    expect(before).toMatchObject({
      headSha: git(cwd, ['rev-parse', 'HEAD']),
      trackedClean: true,
      untrackedFileCount: 0,
      lockfileSha256: hash('{}\n'),
    });
    writeFileSync(join(cwd, 'tracked.txt'), 'private change\n');
    git(cwd, ['add', 'tracked.txt']);
    const changed = sourceSnapshot(cwd);
    expect(changed.trackedClean).toBe(false);
    expect(changed.trackedDiffSha256).not.toBe(before.trackedDiffSha256);
    expect(JSON.stringify(changed)).not.toContain('private change');
    expect(JSON.stringify(changed)).not.toContain(cwd);
    writeFileSync(join(cwd, 'tracked.txt'), 'private change \n');
    expect(sourceSnapshot(cwd).trackedDiffSha256).not.toBe(
      changed.trackedDiffSha256,
    );
  });

  it('distinguishes tested merge, PR head/base, and local origin without dumping env', () => {
    const eventPath = join(cwd, '.release-evidence/event.json');
    mkdirSync(join(cwd, '.release-evidence'));
    const head = git(cwd, ['rev-parse', 'HEAD']);
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          head: { sha: 'a'.repeat(40) },
          base: { sha: head },
          body: 'sensitive-test-token',
        },
      }),
    );
    const report = createEvidence(['test'], cwd, {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: 'example/core',
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_SHA: head,
      GITHUB_JOB: 'tests',
      GITHUB_EVENT_NAME: 'pull_request',
      NPM_TOKEN: 'sensitive-test-token',
      HOME: '/Users/private-user',
    });
    expect(report.source).toMatchObject({
      kind: 'github-actions',
      baseSha: head,
      pullRequestHeadSha: 'a'.repeat(40),
      eventSha: head,
    });
    expect(report.ci).toMatchObject({
      runUrl: 'https://github.com/example/core/actions/runs/123',
      attempt: 2,
    });
    expect(JSON.stringify(report)).not.toMatch(
      /sensitive-test-token|private-user|event\.json/,
    );
    expect(createEvidence([], cwd, {}).source.kind).toBe('local');
  });

  it('preserves nonzero exit status and leaves later planned checks skipped', async () => {
    initialize(['first', 'broken', 'later'], cwd, {});
    expect(
      await runCheck('first', nodeCommand('process.exit(0)'), { cwd }),
    ).toBe(0);
    expect(
      await runCheck('broken', nodeCommand('process.exit(7)'), { cwd }),
    ).toBe(7);
    finalize(cwd);
    const report = readJson(evidencePath(cwd));
    expect(report.result).toBe('failed');
    expect(report.checks.map(({ status }) => status)).toEqual([
      'passed',
      'failed',
      'skipped',
    ]);
    expect(report.checks[1]).toMatchObject({
      exitCode: 7,
      durationMs: expect.any(Number),
    });
  });

  it('records unavailable executables and interrupted child processes honestly', async () => {
    initialize(['missing', 'signal'], cwd, {});
    expect(
      await runCheck('missing', ['nonexistent-evidence-command-unique'], {
        cwd,
      }),
    ).toBe(127);
    expect(
      await runCheck(
        'signal',
        nodeCommand('process.kill(process.pid, "SIGTERM")'),
        { cwd },
      ),
    ).toBe(143);
    finalize(cwd);
    expect(readJson(evidencePath(cwd)).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'missing',
          status: 'unavailable',
          exitCode: 127,
        }),
        expect.objectContaining({
          id: 'signal',
          status: 'failed',
          signal: 'SIGTERM',
          exitCode: 143,
        }),
      ]),
    );
  });

  posixIt(
    'forwards parent SIGTERM to the child group and retains partial evidence',
    async () => {
      initialize(['signal', 'later'], cwd, {});
      const temporary = join(cwd, '.release-evidence');
      const leaderPath = join(temporary, 'signal-leader.mjs');
      const descendantPath = join(temporary, 'signal-descendant.mjs');
      const pidPath = join(temporary, 'signal-pids.json');
      writeFileSync(
        descendantPath,
        `process.once('SIGTERM', () => {
  process.send({ event: 'descendant-sigterm' }, () => process.exit(0));
});
process.send({ event: 'ready' });
setInterval(() => {}, 1000);
`,
      );
      writeFileSync(
        leaderPath,
        `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const descendant = spawn(process.execPath, [process.argv[2]], {
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
});
writeFileSync(process.argv[3], JSON.stringify({ leader: process.pid, descendant: descendant.pid }));
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
let signaled = false;
let descendantExited = false;
const keepAlive = setInterval(() => {}, 1000);
const finish = () => { if (signaled && descendantExited) clearInterval(keepAlive); };
process.once('SIGTERM', () => {
  signaled = true;
  emit({ event: 'leader-sigterm' });
  finish();
});
descendant.on('message', (message) => emit(message));
descendant.once('exit', (code, signal) => {
  descendantExited = true;
  emit({ event: 'descendant-exit', code, signal });
  finish();
});
`,
      );
      const cliPath = fileURLToPath(
        new URL('./release-evidence.js', import.meta.url),
      );
      const wrapper = spawn(
        process.execPath,
        [
          cliPath,
          'run',
          'signal',
          '--',
          process.execPath,
          leaderPath,
          descendantPath,
          pidPath,
        ],
        {
          cwd,
          env: { ...process.env, GITHUB_ACTIONS: '' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const events = [];
      let stdout = '';
      let stderr = '';
      let resolveReady;
      let rejectReady;
      const ready = new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      wrapper.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        let newline;
        while ((newline = stdout.indexOf('\n')) !== -1) {
          const line = stdout.slice(0, newline);
          stdout = stdout.slice(newline + 1);
          try {
            const event = JSON.parse(line);
            events.push(event);
            if (event.event === 'ready') resolveReady();
          } catch {
            rejectReady(new Error('Unexpected child readiness output.'));
          }
        }
      });
      wrapper.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      wrapper.once('error', rejectReady);
      const completed = new Promise((resolve) => {
        wrapper.once('close', (code, signal) => {
          rejectReady(new Error(`Wrapper exited before readiness: ${stderr}`));
          resolve({ code, signal });
        });
      });
      let timer;
      const deadline = new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out waiting for signal fixture.')),
          8000,
        );
      });
      try {
        // The descendant sends readiness through IPC only after its handler is
        // installed; the leader relays it without choosing when to signal it.
        await Promise.race([ready, deadline]);
        wrapper.kill('SIGTERM');
        expect(await Promise.race([completed, deadline])).toEqual({
          code: 143,
          signal: null,
        });
        expect(events).toEqual(
          expect.arrayContaining([
            { event: 'leader-sigterm' },
            { event: 'descendant-sigterm' },
            { event: 'descendant-exit', code: 0, signal: null },
          ]),
        );
        const pids = readJson(pidPath);
        // The leader waits for the descendant's exit, so these checks do not
        // race an orphan that merely received a signal but has not terminated.
        for (const pid of Object.values(pids)) {
          expect(() => process.kill(pid, 0)).toThrow();
        }
        finalize(cwd);
        expect(readJson(evidencePath(cwd))).toMatchObject({
          result: 'failed',
          checks: [
            {
              id: 'signal',
              status: 'failed',
              signal: 'SIGTERM',
              exitCode: 143,
            },
            { id: 'later', status: 'skipped', reason: 'not-reached' },
          ],
        });
      } finally {
        clearTimeout(timer);
        const pids = readJson(pidPath);
        // Read persisted PIDs even when readiness never arrives. Only this
        // fixture's detached group and recorded children are eligible targets.
        for (const pid of [
          -(pids?.leader || 0),
          ...Object.values(pids || {}),
        ]) {
          if (pid) {
            try {
              process.kill(pid, 'SIGKILL');
            } catch {
              // The expected successful path has already reaped both children.
            }
          }
        }
        wrapper.kill('SIGKILL');
        await completed;
      }
    },
    15000,
  );

  it('does not let malformed or unwritable metadata suppress the command', async () => {
    mkdirSync(join(cwd, '.release-evidence'));
    writeFileSync(evidencePath(cwd), '{}');
    expect(
      await runCheck('check', nodeCommand('process.exit(7)'), { cwd }),
    ).toBe(7);
    expect(readJson(evidencePath(cwd)).checks[0].status).toBe('failed');
    rmSync(join(cwd, '.release-evidence'), { recursive: true });
    writeFileSync(join(cwd, '.release-evidence'), 'not a directory');
    expect(
      await runCheck('check', nodeCommand('process.exit(13)'), { cwd }),
    ).toBe(13);
    expect(await runCli(['finish'], cwd, {})).toBe(1);
  });

  it('starts fresh attempts instead of inheriting a prior pass', async () => {
    initialize(['check'], cwd, {});
    await runCheck('check', nodeCommand('process.exit(0)'), { cwd });
    finalize(cwd);
    expect(readJson(evidencePath(cwd)).result).toBe('passed');
    initialize(['check', 'later'], cwd, {});
    finalize(cwd);
    expect(readJson(evidencePath(cwd))).toMatchObject({
      result: 'incomplete',
      checks: [
        expect.objectContaining({ status: 'skipped' }),
        expect.objectContaining({ status: 'skipped' }),
      ],
    });
  });

  it('rejects foreign CI attempts and finalizes the same attempt repeatedly', async () => {
    const first = {
      ...process.env,
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'example/core',
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'tests',
    };
    const stale = initialize(['earlier', 'check'], cwd, first);
    stale.checks[0].status = 'passed';
    stale.checks[0].exitCode = 0;
    writeEvidence(stale, cwd);
    const second = { ...first, GITHUB_RUN_ATTEMPT: '2' };
    expect(
      await runCheck('check', nodeCommand('process.exit(0)'), {
        cwd,
        env: second,
      }),
    ).toBe(0);
    expect(readJson(evidencePath(cwd))).toMatchObject({
      ci: { attempt: 2 },
      checks: [{ id: 'check', status: 'passed' }],
    });
    expect(finalize(cwd, second)).toBe(true);
    expect(await runCli(['finish'], cwd, second)).toBe(0);
    expect(readJson(evidencePath(cwd)).checks.map(({ id }) => id)).toEqual([
      'check',
    ]);
    expect(finalize(cwd, { ...second, GITHUB_RUN_ATTEMPT: '3' })).toBe(true);
    expect(readJson(evidencePath(cwd))).toMatchObject({
      result: 'incomplete',
      ci: { attempt: 3 },
      checks: [],
    });
  });

  it('does not call conditionally skipped or unfinished checks passed', async () => {
    initialize(['analysis', 'interrupted'], cwd, {});
    await runCli(['skip', 'analysis', 'condition-false'], cwd, {});
    const report = readJson(evidencePath(cwd));
    report.checks[1].status = 'running';
    writeEvidence(report, cwd);
    finalize(cwd);
    expect(readJson(evidencePath(cwd))).toMatchObject({
      result: 'incomplete',
      checks: [
        expect.objectContaining({
          status: 'skipped',
          reason: 'condition-false',
        }),
        expect.objectContaining({
          status: 'unavailable',
          reason: 'completion-not-recorded',
        }),
      ],
    });
  });

  it('detects a change tested between snapshots even if restored before finish', async () => {
    initialize(['test'], cwd, {});
    writeFileSync(join(cwd, 'tracked.txt'), 'changed\n');
    await runCheck('test', nodeCommand('process.exit(0)'), { cwd });
    writeFileSync(join(cwd, 'tracked.txt'), 'original\n');
    finalize(cwd);
    expect(readJson(evidencePath(cwd))).toMatchObject({
      result: 'incomplete',
      source: { changedDuringRun: true },
    });
  });

  it('does not claim complete source identity with untracked inputs or no Git metadata', () => {
    writeFileSync(join(cwd, 'untracked-input.js'), 'export default 1;');
    const report = createEvidence(['check'], cwd, {});
    report.checks[0].status = 'passed';
    expect(finishEvidence(report, cwd).result).toBe('incomplete');
    rmSync(join(cwd, '.git'), { recursive: true });
    const noGit = createEvidence(['check'], cwd, {});
    noGit.checks[0].status = 'passed';
    expect(finishEvidence(noGit, cwd).result).toBe('incomplete');
  });

  it('extracts fresh structured counts without confusing coverage failure with success', async () => {
    initialize(['test'], cwd, {});
    const payload = {
      numTotalTests: 2,
      numPassedTests: 2,
      numFailedTests: 0,
      numTotalTestSuites: 1,
      snapshot: { total: 3, matched: 3 },
      testResults: [
        {
          name: '/Users/private-user/test.js',
          failureMessage: 'sensitive-test-token',
        },
      ],
    };
    const script = `require('node:fs').writeFileSync(process.argv[process.argv.indexOf('--outputFile')+1], ${JSON.stringify(JSON.stringify(payload))}); process.exit(1);`;
    expect(
      await runCheck('test', nodeCommand(script), { cwd, jest: true }),
    ).toBe(1);
    let report = readJson(evidencePath(cwd));
    expect(report.checks[0]).toMatchObject({
      status: 'failed',
      tests: { status: 'available', numTotalTests: 2, snapshots: { total: 3 } },
    });
    expect(JSON.stringify(report)).not.toMatch(
      /private-user|sensitive-test-token|testResults/,
    );
    await runCheck('test', nodeCommand('process.exit(1)'), { cwd, jest: true });
    report = readJson(evidencePath(cwd));
    expect(report.checks[0].tests).toEqual({ status: 'unavailable' });
    expect(jestCounts(join(cwd, 'missing.json'))).toEqual({
      status: 'unavailable',
    });
  });

  it('hashes the existing tarball bytes and reduces fixture outcomes safely', () => {
    const events = join(cwd, '.release-evidence/events.jsonl');
    mkdirSync(join(cwd, '.release-evidence'));
    writeFileSync(events, '');
    process.env.EMULSIFY_RELEASE_EVIDENCE_EVENTS = events;
    const tarball = join(cwd, '.release-evidence/core.tgz');
    writeFileSync(tarball, 'exact existing package bytes');
    recordTarballEvidence(tarball, {
      version: '1.0.0',
      filename: '/private/path',
      secret: 'sensitive-test-token',
    });
    recordFixturePlan('consumer', ['clean', 'broken', 'later']);
    recordFixtureOutcome('consumer', 'clean', 'passed', 12);
    recordFixtureOutcome('consumer', 'broken', 'failed', 9);
    recordBrowserEvidence('Chromium', 'Chrome/123.0.0.0');
    const details = collectDetails(events);
    expect(details.tarballs[0]).toMatchObject({
      filename: 'core.tgz',
      sha256: hash('exact existing package bytes'),
      size: 28,
    });
    expect(details.fixtures.map(({ status }) => status)).toEqual([
      'passed',
      'failed',
      'skipped',
    ]);
    expect(details.browsers).toMatchObject({
      status: 'observed',
      values: [
        { type: 'browser', name: 'Chromium', version: 'Chrome/123.0.0.0' },
      ],
    });
    expect(JSON.stringify(details)).not.toMatch(
      /private\/path|sensitive-test-token/,
    );
    rmSync(tarball);
    expect(collectDetails(events).tarballs[0].sha256).toBe(
      details.tarballs[0].sha256,
    );
  });

  it('rejects private or unknown sidecar fields and handles malformed details', () => {
    const path = join(cwd, '.release-evidence/events.jsonl');
    mkdirSync(join(cwd, '.release-evidence'));
    writeFileSync(
      path,
      [
        {
          type: 'browser',
          name: 'Chromium',
          version: 'Chrome/123',
          privatePath: '/Users/private-user',
          privateToken: 'sensitive-test-token',
        },
        {
          type: 'tarball',
          filename: '/Users/private-user/core.tgz',
          secret: 'sensitive-test-token',
        },
        { type: 'fixture-plan', kind: 'consumer', names: null },
        { type: 'environment', NPM_TOKEN: 'sensitive-test-token' },
      ]
        .map(JSON.stringify)
        .join('\n'),
    );
    expect(JSON.stringify(collectDetails(path))).not.toMatch(
      /private-user|sensitive-test-token|privatePath|NPM_TOKEN/,
    );
    writeFileSync(path, '{');
    expect(collectDetails(path)).toEqual({ status: 'unavailable' });
  });

  it('keeps the existing aggregate sequence and stops immediately at the first failure', async () => {
    const bin = join(cwd, '.release-evidence/bin');
    mkdirSync(bin, { recursive: true });
    const npm = join(bin, 'npm');
    const log = join(cwd, '.release-evidence/calls.jsonl');
    writeFileSync(
      npm,
      `#!${process.execPath}\nconst fs=require('node:fs'); const args=process.argv.slice(2); if(args[0]==='--version'){console.log('11.17.0');process.exit(0);} fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args)+'\\n'); process.exit(args[1]==='lint'?9:0);\n`,
    );
    chmodSync(npm, 0o755);
    process.env.PATH = `${bin}${delimiter}${originalPath}`;
    expect(releaseChecks.map(([id]) => id)).toEqual([
      'check-node-version',
      'lint',
      'test',
      'storybook-build',
      'fixtures-release',
      'fixtures-consumer',
      'pack-dry-run',
      'smoke-pack',
      'release-analysis',
    ]);
    expect(await verify(cwd, process.env)).toBe(9);
    expect(
      readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse),
    ).toEqual([
      ['run', 'check-node-version'],
      ['run', 'lint'],
    ]);
    const report = readJson(evidencePath(cwd));
    expect(report.checks[1].status).toBe('failed');
    expect(
      report.checks.slice(2).every(({ status }) => status === 'skipped'),
    ).toBe(true);
  });
});
