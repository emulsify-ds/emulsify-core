/**
 * @file Internal, opt-in release evidence with no consumer or publishing API.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { arch, platform, release } from 'node:os';
import { basename, dirname, resolve } from 'node:path';

export const evidencePath = (cwd = process.cwd()) =>
  resolve(cwd, '.release-evidence/report.json');

const digest = (value, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(value).digest(encoding);
const sha = (value) =>
  typeof value === 'string' && /^[a-f0-9]{40,64}$/.test(value) ? value : null;
const label = (value) =>
  typeof value === 'string' &&
  /^[a-zA-Z0-9@][a-zA-Z0-9@._/-]{0,119}$/.test(value) &&
  !value.includes('..')
    ? value
    : null;
const version = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9.+/ -]{0,99}$/.test(value)
    ? value
    : null;

export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function commandText(command, args, cwd, trim = true) {
  try {
    const output = execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return trim ? output.trim() : output;
  } catch {
    return null;
  }
}

function fileDigest(path) {
  try {
    return digest(readFileSync(path));
  } catch {
    return null;
  }
}

/** Capture identity without storing paths, diff contents, or environment dumps. */
export function sourceSnapshot(cwd = process.cwd()) {
  const status = commandText(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    cwd,
  );
  const diff = commandText(
    'git',
    ['diff', '--binary', 'HEAD', '--'],
    cwd,
    false,
  );
  const untracked = commandText(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z'],
    cwd,
  );
  return {
    headSha: sha(commandText('git', ['rev-parse', '--verify', 'HEAD'], cwd)),
    trackedClean: status === null ? null : status === '',
    trackedDiffSha256: diff === null ? null : digest(diff),
    lockfileSha256: fileDigest(resolve(cwd, 'package-lock.json')),
    untrackedFileCount:
      untracked === null ? null : untracked.split('\0').filter(Boolean).length,
  };
}

export function runtimeSnapshot(cwd = process.cwd()) {
  return {
    node: process.version,
    npm: version(commandText('npm', ['--version'], cwd)),
    os: platform(),
    osRelease: version(release()),
    arch: arch(),
  };
}

/** Initialize a new attempt; previous results are never carried into it. */
export function createEvidence(
  checkIds,
  cwd = process.cwd(),
  env = process.env,
) {
  const remote = env.GITHUB_ACTIONS === 'true';
  const event = remote ? readJson(env.GITHUB_EVENT_PATH) : null;
  const repository = label(env.GITHUB_REPOSITORY);
  const runId = /^\d+$/.test(env.GITHUB_RUN_ID || '')
    ? env.GITHUB_RUN_ID
    : null;
  const runUrl =
    remote && repository && runId
      ? `https://github.com/${repository}/actions/runs/${runId}`
      : null;
  const manifest = readJson(resolve(cwd, 'package.json'));
  return {
    schemaVersion: 1,
    purpose: 'verification-only; not approval, risk acceptance, or publication',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: 'incomplete',
    source: {
      kind: remote ? 'github-actions' : 'local',
      before: sourceSnapshot(cwd),
      after: null,
      baseSha: sha(
        commandText(
          'git',
          [
            'rev-parse',
            '--verify',
            `${env.RELEASE_FROM || env.RELEASE_BASE || event?.pull_request?.base?.sha || 'origin/main'}^{commit}`,
          ],
          cwd,
        ),
      ),
      pullRequestHeadSha: sha(event?.pull_request?.head?.sha),
      eventSha: sha(env.GITHUB_SHA),
      changedDuringRun: null,
    },
    runtime: runtimeSnapshot(cwd),
    package: {
      name: label(manifest?.name),
      version: version(manifest?.version),
    },
    ci: remote
      ? {
          runUrl,
          attempt: /^\d+$/.test(env.GITHUB_RUN_ATTEMPT || '')
            ? Number(env.GITHUB_RUN_ATTEMPT)
            : null,
          job: label(env.GITHUB_JOB),
          event: label(env.GITHUB_EVENT_NAME),
        }
      : null,
    logs: remote
      ? { kind: 'github-actions', runUrl }
      : { kind: 'console', retainedByCollector: false },
    checks: checkIds.map((id) => ({
      id,
      status: 'skipped',
      reason: 'not-reached',
      exitCode: null,
      durationMs: null,
    })),
  };
}

/** Evidence failures are visible but never replace the checked command's status. */
export function writeEvidence(report, cwd = process.cwd()) {
  try {
    const path = evidencePath(cwd);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
    renameSync(temporary, path);
    return true;
  } catch {
    console.error(
      'Release evidence could not be written; any existing report is stale and must not be used for this attempt. Verification status is unchanged.',
    );
    return false;
  }
}

/** Hooks append selected facts only when invoked by the evidence collector. */
function record(event) {
  if (!process.env.EMULSIFY_RELEASE_EVIDENCE_EVENTS) return;
  try {
    appendFileSync(
      process.env.EMULSIFY_RELEASE_EVIDENCE_EVENTS,
      `${JSON.stringify(event)}\n`,
    );
  } catch {
    console.error(
      'Release detail could not be recorded; verification continues.',
    );
  }
}

export function recordTarballEvidence(path, metadata) {
  if (!process.env.EMULSIFY_RELEASE_EVIDENCE_EVENTS) return;
  try {
    const bytes = readFileSync(path);
    record({
      type: 'tarball',
      filename: label(basename(path)),
      packageVersion: version(metadata.version),
      npmVersionInPackProcess: version(
        commandText('npm', ['--version'], process.cwd()),
      ),
      size: bytes.length,
      sha256: digest(bytes),
      integrity: `sha512-${digest(bytes, 'sha512', 'base64')}`,
      role: 'created-test-input; check outcome determines verification',
    });
  } catch {
    record({ type: 'tarball', status: 'unavailable' });
  }
}

export function recordFixturePlan(kind, names) {
  if (!['release', 'consumer'].includes(kind)) return;
  record({
    type: 'fixture-plan',
    kind,
    names: names.map(label).filter(Boolean),
  });
}

export function recordFixtureOutcome(kind, name, status, durationMs) {
  if (
    !['release', 'consumer'].includes(kind) ||
    !label(name) ||
    !['running', 'passed', 'failed'].includes(status)
  )
    return;
  record({
    type: 'fixture',
    kind,
    name,
    status,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : null,
  });
}

export function recordBrowserEvidence(name, observedVersion) {
  record({
    type: 'browser',
    name: label(name),
    version: version(observedVersion),
  });
}

export function recordReleaseAnalysis(prediction, { baseSha, headSha }) {
  record({
    type: 'release-analysis',
    publishing: false,
    baseSha: sha(baseSha),
    headSha: sha(headSha),
    releaseTag: version(prediction.releaseTag),
    previousVersion: version(prediction.previousVersion),
    releaseType: ['major', 'minor', 'patch'].includes(prediction.releaseType)
      ? prediction.releaseType
      : null,
    predictedVersion: version(prediction.predictedVersion),
    packageVersion: version(prediction.packageVersion),
    commitCount: Number.isInteger(prediction.commitCount)
      ? prediction.commitCount
      : null,
    squashChecked: prediction.squashReleaseType !== undefined,
    squashReleaseType: prediction.squashReleaseType || null,
  });
}

// Revalidate the sidecar at its read boundary; do not forward arbitrary fields.
function publicEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const count = (value) =>
    Number.isFinite(value) && value >= 0 ? value : null;
  if (event.type === 'tarball') {
    return {
      type: 'tarball',
      filename: label(event.filename),
      packageVersion: version(event.packageVersion),
      npmVersionInPackProcess: version(event.npmVersionInPackProcess),
      size: count(event.size),
      sha256: sha(event.sha256),
      integrity:
        typeof event.integrity === 'string' &&
        /^sha512-[a-zA-Z0-9+/]+=*$/.test(event.integrity)
          ? event.integrity
          : null,
      role: 'created-test-input; check outcome determines verification',
      ...(event.status === 'unavailable' ? { status: 'unavailable' } : {}),
    };
  }
  if (event.type === 'browser') {
    return label(event.name) && version(event.version)
      ? { type: 'browser', name: event.name, version: event.version }
      : null;
  }
  if (event.type === 'release-analysis') {
    const releaseType = (value) =>
      ['major', 'minor', 'patch'].includes(value) ? value : null;
    return {
      type: event.type,
      publishing: false,
      baseSha: sha(event.baseSha),
      headSha: sha(event.headSha),
      releaseTag: version(event.releaseTag),
      previousVersion: version(event.previousVersion),
      releaseType: releaseType(event.releaseType),
      predictedVersion: version(event.predictedVersion),
      packageVersion: version(event.packageVersion),
      commitCount: count(event.commitCount),
      squashChecked: event.squashChecked === true,
      squashReleaseType: releaseType(event.squashReleaseType),
    };
  }
  if (!['release', 'consumer'].includes(event.kind)) return null;
  if (event.type === 'fixture-plan' && Array.isArray(event.names)) {
    return {
      type: event.type,
      kind: event.kind,
      names: event.names.map(label).filter(Boolean),
    };
  }
  if (
    event.type === 'fixture' &&
    label(event.name) &&
    ['running', 'passed', 'failed'].includes(event.status)
  ) {
    return {
      type: event.type,
      kind: event.kind,
      name: event.name,
      status: event.status,
      durationMs: count(event.durationMs),
    };
  }
  return null;
}

/** Reduce hook events without importing private paths or arbitrary process output. */
export function collectDetails(path) {
  let events;
  try {
    events = readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse)
      .map(publicEvent)
      .filter(Boolean);
  } catch {
    return { status: 'unavailable' };
  }
  const fixtures = new Map();
  for (const event of events) {
    if (event.type === 'fixture-plan') {
      for (const name of event.names) {
        fixtures.set(`${event.kind}:${name}`, {
          kind: event.kind,
          name,
          status: 'skipped',
          reason: 'not-reached',
        });
      }
    }
    if (event.type === 'fixture') {
      fixtures.set(`${event.kind}:${event.name}`, {
        kind: event.kind,
        name: event.name,
        status: event.status === 'running' ? 'unavailable' : event.status,
        durationMs: event.durationMs,
        ...(event.status === 'running'
          ? { reason: 'completion-not-recorded' }
          : {}),
      });
    }
  }
  const browsers = events.filter((event) => event.type === 'browser');
  return {
    tarballs: events.filter((event) => event.type === 'tarball'),
    fixtures: [...fixtures.values()],
    browsers: browsers.length
      ? { status: 'observed', values: browsers }
      : {
          status: 'unavailable',
          reason: 'No browser version observed by this check.',
        },
    releaseAnalysis:
      events.find((event) => event.type === 'release-analysis') || null,
  };
}

/** Keep only aggregate numeric Jest fields; raw results contain local file paths. */
export function jestCounts(path) {
  const result = readJson(path);
  if (!result || !Number.isInteger(result.numTotalTests))
    return { status: 'unavailable' };
  const fields = [
    'numTotalTests',
    'numPassedTests',
    'numFailedTests',
    'numPendingTests',
    'numTodoTests',
    'numTotalTestSuites',
    'numPassedTestSuites',
    'numFailedTestSuites',
    'numPendingTestSuites',
    'numRuntimeErrorTestSuites',
  ];
  const snapshots = [
    'total',
    'added',
    'matched',
    'unchecked',
    'unmatched',
    'updated',
  ];
  const counts = (object, names) =>
    Object.fromEntries(
      names.map((key) => [
        key,
        Number.isInteger(object?.[key]) ? object[key] : null,
      ]),
    );
  return {
    status: 'available',
    ...counts(result, fields),
    snapshots: counts(result.snapshot, snapshots),
  };
}

export function finishEvidence(report, cwd = process.cwd()) {
  report.finishedAt = new Date().toISOString();
  report.source.after = sourceSnapshot(cwd);
  const expected = JSON.stringify(report.source.before);
  report.source.changedDuringRun = [
    report.source.after,
    ...report.checks
      .flatMap((check) => [check.sourceBefore, check.sourceAfter])
      .filter(Boolean),
  ].some((snapshot) => JSON.stringify(snapshot) !== expected);
  for (const check of report.checks) {
    if (check.status === 'running') {
      check.status = 'unavailable';
      check.reason = 'completion-not-recorded';
    }
  }
  report.result = report.checks.some(({ status }) => status === 'failed')
    ? 'failed'
    : report.checks.length &&
        report.checks.every(({ status }) => status === 'passed') &&
        !report.source.changedDuringRun &&
        report.source.before.headSha &&
        report.source.before.trackedClean !== null &&
        report.source.before.trackedDiffSha256 &&
        report.source.before.untrackedFileCount === 0
      ? 'passed'
      : 'incomplete';
  return report;
}
