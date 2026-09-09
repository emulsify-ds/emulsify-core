#!/usr/bin/env node
/**
 * @file Capture existing release commands without running a publishing plugin.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isCliEntrypoint } from './lib/cli.js';
import {
  collectDetails,
  createEvidence,
  evidencePath,
  finishEvidence,
  jestCounts,
  readJson,
  runtimeSnapshot,
  sourceSnapshot,
  writeEvidence,
} from './lib/release-evidence.js';

// This is the existing release:verify sequence, including its first-failure stop.
export const releaseChecks = [
  ['check-node-version', ['npm', 'run', 'check-node-version']],
  ['lint', ['npm', 'run', 'lint']],
  ['test', ['npm', 'test'], true],
  ['storybook-build', ['npm', 'run', 'storybook-build']],
  ['fixtures-release', ['npm', 'run', 'fixtures:release']],
  ['fixtures-consumer', ['npm', 'run', 'fixtures:consumer']],
  ['pack-dry-run', ['npm', 'run', 'pack:dry-run']],
  ['smoke-pack', ['npm', 'run', 'smoke:pack']],
  ['release-analysis', ['npm', 'run', 'release:analyze']],
];

function validateId(id) {
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(id || '')) {
    throw new Error('Evidence check IDs must be short lowercase identifiers.');
  }
  return id;
}

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Discard damaged metadata rather than preventing the checked command. */
function readReport(cwd, env = process.env) {
  const report = readJson(evidencePath(cwd));
  if (
    !isObject(report) ||
    report.schemaVersion !== 1 ||
    !isObject(report.source) ||
    !isObject(report.source.before) ||
    !Array.isArray(report.checks)
  ) {
    return null;
  }
  const ids = new Set();
  for (const check of report.checks) {
    if (
      !isObject(check) ||
      !/^[a-z][a-z0-9-]{0,79}$/.test(check.id || '') ||
      ids.has(check.id) ||
      !['skipped', 'running', 'passed', 'failed', 'unavailable'].includes(
        check.status,
      )
    ) {
      return null;
    }
    ids.add(check.id);
  }
  if (env.GITHUB_ACTIONS === 'true') {
    const runUrl =
      /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || '') &&
      /^\d+$/.test(env.GITHUB_RUN_ID || '')
        ? `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : null;
    if (
      !runUrl ||
      !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT || '') ||
      !env.GITHUB_JOB ||
      report.source.kind !== 'github-actions' ||
      report.ci?.runUrl !== runUrl ||
      report.ci?.attempt !== Number(env.GITHUB_RUN_ATTEMPT) ||
      report.ci?.job !== env.GITHUB_JOB
    ) {
      return null;
    }
  } else if (report.source.kind !== 'local') {
    return null;
  }
  return report;
}

/**
 * Forward cancellation to this command's own POSIX process group, then await
 * settlement. Node can signal only the direct child on Windows. A command
 * ignoring cancellation gets five seconds before the group is killed.
 */
async function runCommand(executable, args, options) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(executable, args, {
        ...options,
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      resolve({ status: null, signal: null, error });
      return;
    }

    let commandError;
    let receivedSignal;
    let killTimer;
    const signalChild = (signal) => {
      try {
        if (process.platform !== 'win32' && child.pid) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        // The child/group may already have exited between observation and kill.
      }
    };
    const forwardSignal = (signal) => {
      receivedSignal ||= signal;
      signalChild(signal);
      if (!killTimer) {
        killTimer = setTimeout(() => signalChild('SIGKILL'), 5000);
        killTimer.unref();
      }
    };
    const onInterrupt = () => forwardSignal('SIGINT');
    const onTerminate = () => forwardSignal('SIGTERM');
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
    child.once('error', (error) => {
      commandError = error;
    });
    child.once('close', (status, signal) => {
      clearTimeout(killTimer);
      // Descendants can outlive their group leader or ignore its first signal.
      if (receivedSignal || signal) signalChild('SIGKILL');
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
      resolve({ status, signal, error: commandError, receivedSignal });
    });
  });
}

export function initialize(ids, cwd = process.cwd(), env = process.env) {
  const report = createEvidence([...new Set(ids.map(validateId))], cwd, env);
  writeEvidence(report, cwd);
  return report;
}

/** Run once, stream normal logs, and return the command's original exit code. */
export async function runCheck(
  id,
  command,
  { cwd = process.cwd(), jest = false, env = process.env } = {},
) {
  validateId(id);
  if (!command.length) throw new Error('A command is required after --.');
  let report = readReport(cwd, env);
  if (!report || report.finishedAt) report = initialize([id], cwd, env);
  let check = report.checks.find((entry) => entry.id === id);
  if (!check) {
    check = { id };
    report.checks.push(check);
  }
  // Reset every observation for this check, including failed previous attempts.
  Object.keys(check).forEach((key) => delete check[key]);
  Object.assign(check, {
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    exitCode: null,
    durationMs: null,
    sourceBefore: sourceSnapshot(cwd),
    runtime: runtimeSnapshot(cwd),
  });
  writeEvidence(report, cwd);

  let temporary;
  try {
    temporary = mkdtempSync(join(tmpdir(), 'emulsify-release-evidence-'));
    writeFileSync(join(temporary, 'events.jsonl'), '');
  } catch {
    console.error(
      'Release detail storage unavailable; running the original check.',
    );
  }
  const events = temporary ? join(temporary, 'events.jsonl') : null;
  const jestPath = temporary ? join(temporary, 'jest.json') : null;
  const [executable, ...originalArgs] = command;
  const args =
    jest && jestPath
      ? [...originalArgs, '--', '--json', '--outputFile', jestPath]
      : originalArgs;
  const started = performance.now();
  const result = await runCommand(executable, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...env,
      // Unit tests must not leak their synthetic fixture observations into a run.
      EMULSIFY_RELEASE_EVIDENCE_EVENTS: jest ? '' : events || '',
    },
  });
  const signal = result.receivedSignal || result.signal;
  const exitCode = result.receivedSignal
    ? 128 + (constants.signals[result.receivedSignal] || 1)
    : result.error
      ? result.error.code === 'ENOENT'
        ? 127
        : 1
      : (result.status ??
        (signal ? 128 + (constants.signals[signal] || 1) : 1));
  check.status = result.error
    ? 'unavailable'
    : exitCode === 0
      ? 'passed'
      : 'failed';
  check.exitCode = exitCode;
  check.signal = signal || null;
  check.durationMs = Math.round(performance.now() - started);
  check.finishedAt = new Date().toISOString();
  check.sourceAfter = sourceSnapshot(cwd);
  if (result.error) check.reason = 'command-could-not-start';
  try {
    check.details = events ? collectDetails(events) : { status: 'unavailable' };
    if (jest)
      check.tests = jestPath ? jestCounts(jestPath) : { status: 'unavailable' };
  } catch {
    console.error(
      'Release details unavailable; verification status is unchanged.',
    );
    check.details = { status: 'unavailable' };
    if (jest) check.tests = { status: 'unavailable' };
  }
  writeEvidence(report, cwd);
  if (temporary) {
    try {
      rmSync(temporary, { recursive: true, force: true });
    } catch {
      console.error('Temporary release detail cleanup was unavailable.');
    }
  }
  return exitCode;
}

export function finalize(cwd = process.cwd(), env = process.env) {
  try {
    let report = readReport(cwd, env);
    if (!report) {
      console.error(
        'Release evidence is unavailable; writing an incomplete report.',
      );
      report = createEvidence([], cwd, env);
    }
    const written = writeEvidence(finishEvidence(report, cwd), cwd);
    if (written) {
      console.log(
        'Release evidence: .release-evidence/report.json (verification only).',
      );
    }
    return written;
  } catch {
    console.error(
      'Release finalization unavailable; verification status is unchanged.',
    );
    return false;
  }
}

/** Preserve the old aggregate command order and fail-fast exit behavior. */
export async function verify(cwd = process.cwd(), env = process.env) {
  if (
    env.EMULSIFY_RELEASE_EVIDENCE_CONTINUE !== 'true' ||
    !readReport(cwd, env)
  ) {
    initialize(
      releaseChecks.map(([id]) => id),
      cwd,
      env,
    );
  }
  try {
    for (const [id, command, jest] of releaseChecks) {
      const code = await runCheck(id, command, { cwd, env, jest });
      if (code !== 0) return code;
    }
    return 0;
  } finally {
    finalize(cwd, env);
  }
}

export async function runCli(
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
) {
  const [action, ...args] = argv;
  if (action === 'init') {
    initialize(args, cwd, env);
  } else if (action === 'run') {
    const separator = args.indexOf('--');
    if (
      separator < 1 ||
      args.slice(1, separator).some((arg) => arg !== '--jest')
    ) {
      throw new Error(
        'Usage: release-evidence.js run ID [--jest] -- COMMAND [ARGS]',
      );
    }
    return runCheck(args[0], args.slice(separator + 1), {
      cwd,
      env,
      jest: args.slice(1, separator).includes('--jest'),
    });
  } else if (action === 'skip') {
    const report = readReport(cwd, env);
    const check = report?.checks.find(({ id }) => id === validateId(args[0]));
    if (check && check.status === 'skipped') {
      check.reason =
        args[1] === 'condition-false' ? 'condition-false' : 'not-selected';
      writeEvidence(report, cwd);
    }
  } else if (action === 'finish') {
    return finalize(cwd, env) ? 0 : 1;
  } else if (action === 'verify') {
    return verify(cwd, env);
  } else {
    throw new Error('Usage: release-evidence.js init|run|skip|finish|verify');
  }
  return 0;
}

if (isCliEntrypoint(['release-evidence.js'])) {
  runCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      console.error(
        'Release evidence command could not run; check its arguments and repository context.',
      );
      process.exitCode = 1;
    });
}
