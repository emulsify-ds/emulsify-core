/**
 * @file Autofix application for audit findings.
 *
 * A finding becomes fixable by carrying a `fix` payload: the byte range of the
 * URL specifier in the authored source, the exact text expected there, and the
 * replacement. Checks decide what is safe to rewrite; this module only applies
 * what they hand over.
 */

import { writeFileSync } from 'node:fs';

import { cachedReadFile, resetFileReadCache } from './lib/files.js';

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
 * @param {{dryRun?: boolean}} [options={}] - Fix options.
 * @returns {{applied: object[], skipped: object[], dryRun: boolean}} Fix result.
 */
export function applyAuditFixes(findings = [], { dryRun = false } = {}) {
  const applied = [];
  const skipped = [];
  let wrote = false;

  for (const [filePath, fileFindings] of groupFixesByFile(findings)) {
    const source = cachedReadFile(filePath);
    const ordered = [...fileFindings].sort((a, b) => b.fix.start - a.fix.start);

    let next = source;
    let lastStart = Number.POSITIVE_INFINITY;
    let changed = false;

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
      changed = true;
      applied.push({ finding, from: original, to: replacement });
    }

    if (!changed || dryRun) continue;

    writeFileSync(filePath, next, 'utf8');
    wrote = true;
  }

  // The audit reads through a process-local cache; leaving it warm after a
  // write would make a follow-up scan report findings that no longer exist.
  if (wrote) resetFileReadCache();

  return { applied, skipped, dryRun };
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
