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
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { resetFileReadCache } from './lib/files.js';

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
 * Reject a source path or file that changed after it was inspected.
 *
 * @param {string} filePath - Original path carried by the finding.
 * @param {string} realTarget - Canonical target resolved before editing.
 * @param {string} realRoot - Canonical scanned root.
 * @param {Buffer} expectedBytes - Bytes used to prepare the replacement.
 * @returns {void}
 */
function validateTarget(filePath, realTarget, realRoot, expectedBytes) {
  const currentTarget = fs.realpathSync(resolve(filePath));

  if (currentTarget !== realTarget || !isContained(currentTarget, realRoot)) {
    throw new Error('source path changed while applying audit fixes');
  }
  if (!fs.readFileSync(currentTarget).equals(expectedBytes)) {
    throw new Error('source changed while applying audit fixes');
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
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const mode = fs.statSync(filePath).mode & 0o7777;

  try {
    fs.writeFileSync(temporaryPath, contents, { flag: 'wx', mode });
    fs.chmodSync(temporaryPath, mode);
    validate();
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (cleanupError) {
      // Preserve the failure that prevented the replacement. A missing temp
      // file simply means the exclusive create failed before it existed.
      if (cleanupError?.code !== 'ENOENT') {
        error.cleanupError = cleanupError;
        error.message = `${error.message}; unable to remove temporary file ${temporaryPath}: ${cleanupError.message || cleanupError}`;
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
 * @param {{dryRun?: boolean, projectDir?: string}} [options={}] - Fix options.
 * @returns {{applied: object[], skipped: object[], dryRun: boolean}} Fix result.
 */
export function applyAuditFixes(
  findings = [],
  { dryRun = false, projectDir = process.cwd() } = {},
) {
  const applied = [];
  const skipped = [];
  const fixes = { applied, skipped, dryRun };
  const fixesByFile = groupFixesByFile(findings);
  if (!fixesByFile.size) return fixes;

  let wrote = false;
  let activeFilePath = resolve(projectDir);

  try {
    const realRoot = fs.realpathSync(resolve(projectDir));

    for (const [filePath, fileFindings] of fixesByFile) {
      activeFilePath = filePath;
      const realTarget = fs.realpathSync(resolve(filePath));

      if (!isContained(realTarget, realRoot)) {
        skipFile(
          skipped,
          fileFindings,
          `real target is outside scanned root: ${realTarget}`,
        );
        continue;
      }

      const bytes = fs.readFileSync(realTarget);
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
      let next = source;
      let lastStart = Number.POSITIVE_INFINITY;

      for (const finding of ordered) {
        const { start, end, original, replacement } = finding.fix;

        if (end > lastStart) {
          skipped.push({ finding, reason: 'overlaps another fix' });
          continue;
        }
        if (next.slice(start, end) !== original) {
          skipped.push({ finding, reason: 'source no longer matches' });
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

      const validate = () =>
        validateTarget(filePath, realTarget, realRoot, bytes);
      atomicReplace(realTarget, Buffer.from(next, 'utf8'), validate);
      wrote = true;
      applied.push(...pendingApplied);
    }
  } catch (error) {
    throw createFixError(error, activeFilePath, fixes);
  } finally {
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
