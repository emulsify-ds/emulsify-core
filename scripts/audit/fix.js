/**
 * @file Autofix application for audit findings.
 *
 * A finding becomes fixable by carrying a `fix` payload: the source range of the
 * URL specifier in the authored source, the exact text expected there, and the
 * replacement. Checks decide what is safe to rewrite; this module only applies
 * what they hand over.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
  clearImmediate as cancelImmediate,
  setImmediate as scheduleImmediate,
} from 'node:timers';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { escape, globSync } from 'glob';

import { resolveProjectConfig } from '../../config/vite/project-config.js';
import {
  DEFAULT_IGNORES,
  normalizeAuditRoots,
  resetFileReadCache,
} from './lib/files.js';

const maximumTemporaryNameBytes = 255;
const temporaryFileGlob = '**/.*.*.*.tmp';
const temporaryFilePattern =
  /^\..+\.(\d+)\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i;
const ignoredCleanupErrors = new Set(['ENOENT', 'ENAMETOOLONG']);
const activeTemporaryFiles = new Map();
let temporaryCleanupHandlersInstalled = false;
let temporaryCleanupTurn;

/**
 * Determine whether a canonical path is inside the canonical scanned root.
 *
 * @param {string} filePath - Canonical candidate path.
 * @param {string} root - Canonical scanned root.
 * @returns {boolean} TRUE when the candidate is inside or equal to the root.
 */
function isContained(filePath, root) {
  const rel = relative(root, filePath);
  return (
    !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
  );
}

/**
 * Determine whether a path is excluded by the audit's scan rules.
 *
 * Ignore patterns are evaluated relative to the project, just as consumers
 * understand directories such as node_modules/ and dist/. An absolute path is
 * never matched: a project may itself live beneath a pnpm node_modules tree.
 *
 * @param {string} filePath - Candidate path.
 * @param {string} root - Root against which ignore patterns are evaluated.
 * @returns {boolean} TRUE when the candidate is ignored.
 */
function isIgnored(filePath, root) {
  if (!isContained(filePath, root)) return false;

  const rel = relative(root, filePath);
  if (!rel) return false;

  // Probe the literal existing path through the same glob implementation and
  // options used to collect audit files. This preserves its platform-aware
  // case behavior and keeps the scan and write deny-lists identical.
  const literalPath = escape(rel.split(sep).join('/'), {
    magicalBraces: true,
  });
  return (
    globSync(literalPath, {
      cwd: root,
      nodir: true,
      ignore: DEFAULT_IGNORES,
    }).length === 0
  );
}

/**
 * Resolve the lexical and canonical boundaries that authorize source writes.
 *
 * @param {string} projectDir - Project root supplied to the audit.
 * @param {string[]|undefined} sourceRoots - Normalized source roots.
 * @returns {object} Canonical fix scope.
 */
function createFixScope(projectDir, sourceRoots) {
  const projectPath = resolve(projectDir);
  const realProject = fs.realpathSync(projectPath);
  let requestedRoots = Array.isArray(sourceRoots) ? sourceRoots : [];

  if (sourceRoots === undefined) {
    try {
      const env = resolveProjectConfig(projectPath, process.env);
      requestedRoots = normalizeAuditRoots(
        projectPath,
        env.projectStructure?.sourceRoots || [],
      );
    } catch {
      // Direct API callers may omit sourceRoots for compatibility. Derive the
      // same project scope as the audit when possible, and fail closed when
      // invalid configuration prevents that derivation.
      requestedRoots = [];
    }
  }
  const lexicalRoots = [];
  const realRoots = [];

  for (const root of requestedRoots) {
    if (!root) continue;

    const lexicalRoot = resolve(projectPath, root);
    if (!isContained(lexicalRoot, projectPath)) continue;

    let realRoot;
    try {
      realRoot = fs.realpathSync(lexicalRoot);
    } catch {
      continue;
    }
    if (!isContained(realRoot, realProject)) continue;

    if (!lexicalRoots.includes(lexicalRoot)) lexicalRoots.push(lexicalRoot);
    if (!realRoots.includes(realRoot)) realRoots.push(realRoot);
  }

  return {
    projectPath,
    realProject,
    lexicalRoots,
    realRoots,
  };
}

/**
 * Resolve one candidate against a prepared source-write scope.
 *
 * @param {string} filePath - Authored source path carried by a finding.
 * @param {object} scope - Canonical fix scope.
 * @returns {{writable: boolean, realTarget?: string, reason?: string}} Status.
 */
function auditFixTargetStatus(filePath, scope) {
  const sourcePath = resolve(filePath);

  if (!scope.lexicalRoots.some((root) => isContained(sourcePath, root))) {
    return {
      writable: false,
      reason: `source path is outside scanned roots: ${sourcePath}`,
    };
  }

  const realTarget = fs.realpathSync(sourcePath);
  if (!scope.realRoots.some((root) => isContained(realTarget, root))) {
    return {
      writable: false,
      realTarget,
      reason: `real target is outside scanned root: ${realTarget}`,
    };
  }

  if (
    isIgnored(sourcePath, scope.projectPath) ||
    isIgnored(realTarget, scope.realProject)
  ) {
    return {
      writable: false,
      realTarget,
      reason: `real target is excluded by audit ignore rules: ${realTarget}`,
    };
  }

  const targetDirectory = dirname(realTarget);
  try {
    fs.accessSync(targetDirectory, fs.constants.W_OK | fs.constants.X_OK);
  } catch {
    return {
      writable: false,
      realTarget,
      reason: `real target directory is not writable: ${targetDirectory}`,
    };
  }

  return { writable: true, realTarget };
}

/**
 * Determine whether the target metadata captured before a rewrite is stable.
 *
 * @param {import('node:fs').Stats} current - Current target metadata.
 * @param {import('node:fs').Stats} expected - Previously captured metadata.
 * @returns {boolean} TRUE when no inode or portable metadata changed.
 */
function sameTargetMetadata(current, expected) {
  return [
    'dev',
    'ino',
    'mode',
    'uid',
    'gid',
    'size',
    'mtimeMs',
    'ctimeMs',
  ].every((key) => current[key] === expected[key]);
}

/**
 * Create a reusable predicate for automatic source rewrites.
 *
 * This is shared with checks that advertise --fix, so their advice cannot
 * promise a write that applyAuditFixes() will refuse. Scope resolution is lazy
 * and cached; per-file realpath, ignore, and access checks remain current.
 *
 * @param {{projectDir?: string, sourceRoots?: string[]}} [options={}] - Scope.
 * @returns {(filePath: string) => boolean} Source eligibility predicate.
 */
export function createAuditFixTargetChecker({
  projectDir = process.cwd(),
  sourceRoots,
} = {}) {
  let scope;
  let scopeFailed = false;

  return (filePath) => {
    if (!scope && !scopeFailed) {
      try {
        scope = createFixScope(projectDir, sourceRoots);
      } catch {
        scopeFailed = true;
      }
    }
    if (!scope) return false;

    try {
      return auditFixTargetStatus(filePath, scope).writable;
    } catch {
      return false;
    }
  };
}

/**
 * Decide whether the audit may safely offer one automatic source rewrite.
 *
 * @param {string} filePath - Authored source path.
 * @param {{projectDir?: string, sourceRoots?: string[]}} [options={}] - Scope.
 * @returns {boolean} TRUE when the source is inside the writable audit scope.
 */
export function isAuditFixTargetWritable(filePath, options = {}) {
  return createAuditFixTargetChecker(options)(filePath);
}

/**
 * Reject a source path or file that changed after it was inspected.
 *
 * @param {string} filePath - Original path carried by the finding.
 * @param {string} realTarget - Canonical target resolved before editing.
 * @param {object} scope - Canonical source-write scope.
 * @param {Buffer} expectedBytes - Bytes used to prepare the replacement.
 * @param {import('node:fs').Stats} [expectedStat] - Captured target metadata.
 * @returns {void}
 */
function validateTarget(
  filePath,
  realTarget,
  scope,
  expectedBytes,
  expectedStat,
) {
  const current = auditFixTargetStatus(filePath, scope);

  if (!current.writable || current.realTarget !== realTarget) {
    throw new Error('source path changed while applying audit fixes');
  }
  if (!fs.readFileSync(current.realTarget).equals(expectedBytes)) {
    throw new Error('source changed while applying audit fixes');
  }
  if (
    expectedStat &&
    !sameTargetMetadata(fs.statSync(current.realTarget), expectedStat)
  ) {
    throw new Error('source metadata changed while applying audit fixes');
  }
}

/**
 * Preserve target ownership on an atomic replacement inode.
 *
 * @param {number} descriptor - Open temporary-file descriptor.
 * @param {{uid: number, gid: number}} targetStat - Original target metadata.
 * @returns {void}
 */
function preserveOwnership(descriptor, targetStat) {
  if (process.platform === 'win32') return;

  try {
    fs.fchownSync(descriptor, targetStat.uid, targetStat.gid);
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;

    // An unprivileged owner cannot chown even to the ownership the newly
    // created inode already has. Only suppress EPERM when nothing would change.
    const temporaryStat = fs.fstatSync(descriptor);
    if (
      temporaryStat.uid !== targetStat.uid ||
      temporaryStat.gid !== targetStat.gid
    ) {
      throw error;
    }
  }
}

/**
 * Attach a cleanup failure without obscuring the write failure that caused it.
 *
 * @param {Error} error - Primary failure.
 * @param {*} cleanupError - Secondary cleanup failure.
 * @param {string} detail - Human-readable cleanup action.
 * @returns {void}
 */
function attachCleanupError(error, cleanupError, detail) {
  error.cleanupError ??= cleanupError;
  error.message = `${error.message}; ${detail}: ${cleanupError?.message || cleanupError}`;
}

/**
 * Truncate text without splitting a UTF-8 code point.
 *
 * @param {string} value - Filename portion to truncate.
 * @param {number} byteLimit - Maximum UTF-8 byte length.
 * @returns {string} Byte-bounded value.
 */
function truncateUtf8(value, byteLimit) {
  let result = '';
  let bytes = 0;

  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > byteLimit) break;
    result += character;
    bytes += characterBytes;
  }

  return result;
}

/**
 * Create an exclusive temp path whose filename fits the common NAME_MAX.
 *
 * @param {string} filePath - Canonical target path.
 * @returns {string} Same-directory temporary path.
 */
function createTemporaryPath(filePath) {
  const suffix = `.${process.pid}.${randomUUID()}.tmp`;
  const basenameBudget =
    maximumTemporaryNameBytes - Buffer.byteLength(`.${suffix}`);
  const boundedBasename = truncateUtf8(basename(filePath), basenameBudget);

  return join(dirname(filePath), `.${boundedBasename}${suffix}`);
}

/**
 * Remove every active audit-fix temporary file synchronously.
 *
 * @returns {void}
 */
function cleanupActiveTemporaryFiles() {
  for (const [temporaryPath, descriptor] of activeTemporaryFiles) {
    if (descriptor !== undefined) {
      activeTemporaryFiles.set(temporaryPath, undefined);
      try {
        fs.closeSync(descriptor);
      } catch {
        // Process-exit cleanup is best effort; still try to remove the path.
      }
    }

    try {
      fs.unlinkSync(temporaryPath);
      activeTemporaryFiles.delete(temporaryPath);
    } catch (error) {
      if (ignoredCleanupErrors.has(error?.code)) {
        activeTemporaryFiles.delete(temporaryPath);
      }
    }
  }
}

/**
 * Remove this module's process handlers before re-raising a signal.
 *
 * @returns {void}
 */
function removeTemporaryCleanupHandlers() {
  if (!temporaryCleanupHandlersInstalled) return;
  process.removeListener('exit', onTemporaryCleanupExit);
  process.removeListener('SIGINT', onTemporaryCleanupSigint);
  process.removeListener('SIGTERM', onTemporaryCleanupSigterm);
  temporaryCleanupHandlersInstalled = false;
}

/**
 * Cancel the event-loop turn that keeps queued signals deliverable.
 *
 * @returns {void}
 */
function clearTemporaryCleanupTurn() {
  if (temporaryCleanupTurn === undefined) return;
  cancelImmediate(temporaryCleanupTurn);
  temporaryCleanupTurn = undefined;
}

/**
 * Clean active files and preserve the operating system's signal semantics.
 *
 * @param {'SIGINT'|'SIGTERM'} signal - Signal to re-raise.
 * @returns {void}
 */
function forwardTemporaryCleanupSignal(signal, ownHandler) {
  const hasOtherSignalHandler = process
    .listeners(signal)
    .some((listener) => listener !== ownHandler);
  clearTemporaryCleanupTurn();
  cleanupActiveTemporaryFiles();
  removeTemporaryCleanupHandlers();
  if (!hasOtherSignalHandler) process.kill(process.pid, signal);
}

function onTemporaryCleanupExit() {
  clearTemporaryCleanupTurn();
  cleanupActiveTemporaryFiles();
  removeTemporaryCleanupHandlers();
}

function onTemporaryCleanupSigint() {
  forwardTemporaryCleanupSignal('SIGINT', onTemporaryCleanupSigint);
}

function onTemporaryCleanupSigterm() {
  forwardTemporaryCleanupSignal('SIGTERM', onTemporaryCleanupSigterm);
}

/**
 * Install one handler set through the next event-loop turn.
 *
 * Handlers must survive the synchronous applyAuditFixes() call. Node queues a
 * signal received during synchronous I/O until JavaScript yields; removing the
 * listener at function return would swallow that queued signal. A referenced
 * immediate also prevents a short-lived CLI from exiting before delivery.
 *
 * @returns {void}
 */
function installTemporaryCleanupHandlers() {
  if (!temporaryCleanupHandlersInstalled) {
    process.once('exit', onTemporaryCleanupExit);
    process.once('SIGINT', onTemporaryCleanupSigint);
    process.once('SIGTERM', onTemporaryCleanupSigterm);
    temporaryCleanupHandlersInstalled = true;
  }

  if (temporaryCleanupTurn === undefined) {
    temporaryCleanupTurn = scheduleImmediate(() => {
      temporaryCleanupTurn = undefined;
      cleanupActiveTemporaryFiles();
      if (!activeTemporaryFiles.size) removeTemporaryCleanupHandlers();
    });
  }
}

/**
 * Determine whether a PID from a temp filename can still own that file.
 *
 * @param {number} pid - Process identifier.
 * @returns {boolean} TRUE unless the operating system confirms it is gone.
 */
function isProcessAlive(pid) {
  if (pid === process.pid) return true;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

/**
 * Remove abandoned audit-fix temp files from canonical source roots.
 *
 * Only regular files with the exact generated UUID/PID shape are eligible.
 * Live or indeterminate PIDs are retained so concurrent fix runs cannot delete
 * one another's in-progress writes.
 *
 * @param {object} scope - Canonical source-write scope.
 * @returns {void}
 */
function sweepStaleTemporaryFiles(scope) {
  for (const root of scope.realRoots) {
    let candidates;
    try {
      candidates = globSync(temporaryFileGlob, {
        cwd: root,
        absolute: true,
        dot: true,
        follow: false,
        nodir: true,
        ignore: DEFAULT_IGNORES,
      });
    } catch {
      continue;
    }

    for (const candidate of candidates) {
      const match = basename(candidate).match(temporaryFilePattern);
      if (!match || isIgnored(candidate, scope.realProject)) continue;

      const ownerPid = Number(match[1]);
      if (!Number.isSafeInteger(ownerPid) || isProcessAlive(ownerPid)) {
        continue;
      }

      try {
        const candidateStat = fs.lstatSync(candidate);
        const realCandidate = fs.realpathSync(candidate);
        const realCandidateStat = fs.lstatSync(realCandidate);

        if (
          !candidateStat.isFile() ||
          !isContained(realCandidate, root) ||
          isIgnored(realCandidate, scope.realProject) ||
          candidateStat.dev !== realCandidateStat.dev ||
          candidateStat.ino !== realCandidateStat.ino
        ) {
          continue;
        }

        fs.unlinkSync(realCandidate);
      } catch {
        // Cleanup is best effort. A later --fix run can retry a stale file.
      }
    }
  }
}

/**
 * Replace a file atomically through an exclusive temp file beside it.
 *
 * @param {string} filePath - Canonical target path.
 * @param {Buffer} contents - Complete replacement contents.
 * @param {Function} validate - Last-moment source validation.
 * @returns {void}
 */
function atomicReplace(filePath, contents, validate) {
  validate();
  const temporaryPath = createTemporaryPath(filePath);
  const targetStat = fs.statSync(filePath);
  const mode = targetStat.mode & 0o7777;
  let descriptor;
  let temporaryCreated = false;

  try {
    installTemporaryCleanupHandlers();
    descriptor = fs.openSync(temporaryPath, 'wx', mode);
    temporaryCreated = true;
    activeTemporaryFiles.set(temporaryPath, descriptor);
    fs.writeFileSync(descriptor, contents);
    preserveOwnership(descriptor, targetStat);
    // chown may clear setuid/setgid bits, so mode restoration must come last.
    fs.fchmodSync(descriptor, mode);
    const descriptorToClose = descriptor;
    descriptor = undefined;
    activeTemporaryFiles.set(temporaryPath, undefined);
    fs.closeSync(descriptorToClose);
    validate(targetStat);
    fs.renameSync(temporaryPath, filePath);
    activeTemporaryFiles.delete(temporaryPath);
  } catch (error) {
    if (descriptor !== undefined) {
      const descriptorToClose = descriptor;
      descriptor = undefined;

      if (activeTemporaryFiles.has(temporaryPath)) {
        activeTemporaryFiles.set(temporaryPath, undefined);
        try {
          fs.closeSync(descriptorToClose);
        } catch (cleanupError) {
          attachCleanupError(
            error,
            cleanupError,
            'unable to close temporary file',
          );
        }
      }
    }

    if (temporaryCreated) {
      try {
        fs.unlinkSync(temporaryPath);
        activeTemporaryFiles.delete(temporaryPath);
      } catch (cleanupError) {
        // Preserve the failure that prevented the replacement. A missing temp
        // file simply means a watcher removed it before cleanup. An overlong
        // path was never materialized, so it is not a cleanup failure either.
        if (ignoredCleanupErrors.has(cleanupError?.code)) {
          activeTemporaryFiles.delete(temporaryPath);
        } else {
          attachCleanupError(
            error,
            cleanupError,
            `unable to remove temporary file ${temporaryPath}`,
          );
        }
      }
    }
    throw error;
  }
}

/**
 * Add one skip record for every fix targeting an unsafe source file.
 *
 * @param {object[]} skipped - Accumulated skipped records.
 * @param {object[]} findings - Findings targeting the file.
 * @param {string} reason - Human-readable reason.
 * @returns {void}
 */
function skipFile(skipped, findings, reason) {
  for (const finding of findings) {
    skipped.push({ finding, reason });
  }
}

/**
 * Skip only findings not already rejected while preparing the same file.
 *
 * @param {object[]} skipped - Accumulated skipped records.
 * @param {object[]} findings - Findings targeting the failed file.
 * @param {string} reason - Human-readable reason.
 * @param {Set<object>} recorded - Findings already rejected for this file.
 * @returns {void}
 */
function skipUnrecordedFile(skipped, findings, reason, recorded) {
  for (const finding of findings) {
    if (!recorded.has(finding)) skipped.push({ finding, reason });
  }
}

/**
 * Wrap an I/O failure without discarding fixes committed before it.
 *
 * @param {*} error - Original failure.
 * @param {string} filePath - File being processed when it failed.
 * @param {object} fixes - Partial fix result.
 * @returns {Error} Contextual failure.
 */
function createFixError(error, filePath, fixes) {
  const detail = error?.message || error;
  const wrapped = new Error(`Unable to rewrite ${filePath}: ${detail}`, {
    cause: error instanceof Error ? error : undefined,
  });

  wrapped.name = 'AuditFixError';
  wrapped.code = error?.code;
  wrapped.filePath = filePath;
  wrapped.fixes = fixes;

  return wrapped;
}

/**
 * Group fixable findings by the file they edit.
 *
 * @param {object[]} findings - Audit findings.
 * @returns {Map<string, object[]>} Findings keyed by absolute file path.
 */
function groupFixesByFile(findings) {
  const byFile = new Map();

  for (const finding of findings) {
    const filePath = finding?.fix?.filePath;
    if (!filePath) continue;

    const existing = byFile.get(filePath);
    if (existing) existing.push(finding);
    else byFile.set(filePath, [finding]);
  }

  return byFile;
}

/**
 * Apply every fixable finding to its source file.
 *
 * Edits are applied descending by offset, so each one lands to the left of the
 * previous and no offset bookkeeping is needed — two URLs on one line stay
 * independent. Every edit verifies the text it is replacing first, so a stale
 * offset skips one fix rather than corrupting the file.
 *
 * @param {object[]} [findings=[]] - Audit findings.
 * @param {{dryRun?: boolean, projectDir?: string, sourceRoots?: string[]}} [options={}] - Fix options.
 * @returns {{applied: object[], skipped: object[], dryRun: boolean}} Fix result.
 */
export function applyAuditFixes(
  findings = [],
  { dryRun = false, projectDir = process.cwd(), sourceRoots } = {},
) {
  const applied = [];
  const skipped = [];
  const fixes = { applied, skipped, dryRun };
  const fixesByFile = groupFixesByFile(findings);
  if (!fixesByFile.size && dryRun) return fixes;

  let wrote = false;
  let scope;

  try {
    scope = createFixScope(projectDir, sourceRoots);
  } catch (error) {
    throw createFixError(error, resolve(projectDir), fixes);
  }

  try {
    if (!dryRun) sweepStaleTemporaryFiles(scope);

    for (const [filePath, fileFindings] of fixesByFile) {
      let target;
      let bytes;

      try {
        target = auditFixTargetStatus(filePath, scope);
        if (target.writable) bytes = fs.readFileSync(target.realTarget);
      } catch (error) {
        const detail = error?.message || error?.code || error;
        skipFile(skipped, fileFindings, `unable to rewrite file: ${detail}`);
        continue;
      }

      if (!target.writable) {
        skipFile(skipped, fileFindings, target.reason);
        continue;
      }
      const { realTarget } = target;
      const source = bytes.toString('utf8');
      if (!Buffer.from(source, 'utf8').equals(bytes)) {
        skipFile(
          skipped,
          fileFindings,
          'file is not valid UTF-8; left unchanged',
        );
        continue;
      }

      const ordered = [...fileFindings].sort(
        (a, b) => b.fix.start - a.fix.start,
      );
      const pendingApplied = [];
      const rejected = new Set();
      let next = source;
      let lastStart = Number.POSITIVE_INFINITY;

      for (const finding of ordered) {
        const { start, end, original, replacement } = finding.fix;

        if (end > lastStart) {
          skipped.push({ finding, reason: 'overlaps another fix' });
          rejected.add(finding);
          continue;
        }
        if (next.slice(start, end) !== original) {
          skipped.push({ finding, reason: 'source no longer matches' });
          rejected.add(finding);
          continue;
        }

        next = next.slice(0, start) + replacement + next.slice(end);
        lastStart = start;
        pendingApplied.push({ finding, from: original, to: replacement });
      }

      if (!pendingApplied.length) continue;

      if (dryRun) {
        applied.push(...pendingApplied);
        continue;
      }

      const validate = (expectedStat) =>
        validateTarget(filePath, realTarget, scope, bytes, expectedStat);
      const replacementBytes = Buffer.from(next, 'utf8');

      try {
        atomicReplace(realTarget, replacementBytes, validate);
      } catch (error) {
        const detail = error?.message || error?.code || error;
        skipUnrecordedFile(
          skipped,
          fileFindings,
          `unable to rewrite file: ${detail}`,
          rejected,
        );
        continue;
      }

      wrote = true;
      applied.push(...pendingApplied);
    }
  } finally {
    cleanupActiveTemporaryFiles();
    // The audit reads through a process-local cache. This must run even when a
    // later file fails, or a follow-up scan will hide the writes that landed.
    if (wrote) resetFileReadCache();
  }

  return fixes;
}

/**
 * Remove findings an autofix has already resolved.
 *
 * @param {object[]} [findings=[]] - Audit findings.
 * @param {object[]} [applied=[]] - Applied fix records.
 * @returns {object[]} Remaining findings.
 */
export function remainingFindings(findings = [], applied = []) {
  const resolved = new Set(applied.map((entry) => entry.finding));

  return findings.filter((finding) => !resolved.has(finding));
}
