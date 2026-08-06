/**
 * @file Report formatting for the project audit.
 */

import { createRequire } from 'node:module';
import { displayPath } from './lib/findings.js';

const require = createRequire(import.meta.url);
const corePackage = require('../../package.json');
const summarySeverities = ['error', 'warn', 'info'];
const fileCountKeys = ['stories', 'twig', 'code', 'styles'];

export const AUDIT_REPORT_SCHEMA_VERSION = 1;

/**
 * Format one finding for terminal output.
 *
 * @param {object} finding - Finding to format.
 * @param {string} projectDir - Project root.
 * @returns {string[]} Output lines.
 */
function formatFinding(finding, projectDir) {
  const location = finding.filePath
    ? `${displayPath(projectDir, finding.filePath)}${
        finding.line ? `:${finding.line}` : ''
      }`
    : 'project';
  const lines = [
    `[${finding.severity}] ${finding.id}`,
    `  ${location}`,
    `  ${finding.message}`,
  ];

  for (const detail of finding.details || []) {
    lines.push(`  ${detail}`);
  }
  if (finding.docs) {
    lines.push(`  Docs: ${finding.docs}`);
  }

  return lines;
}

/**
 * Format the combined audit report.
 *
 * @param {{projectDir: string, summary: object, files: object, findings: object[]}} result
 * Audit result.
 * @returns {string} Human-readable report.
 */
export function formatAuditReport(result) {
  const lines = [
    'Emulsify project audit',
    `Project: ${result.projectDir}`,
    `Scanned ${result.files.stories} story file(s), ${result.files.twig} Twig file(s), ${result.files.code} code file(s), and ${result.files.styles} style file(s).`,
    `Findings: ${result.summary.error} error(s), ${result.summary.warn} warning(s), ${result.summary.info} info item(s).`,
  ];

  if (!result.findings.length) {
    lines.push('No audit findings found.');
  }

  for (const finding of result.findings) {
    lines.push('', ...formatFinding(finding, result.projectDir));
  }

  lines.push(...formatFixSection(result.fixes, result.projectDir));

  return lines.join('\n');
}

/**
 * Format the autofix section appended by `--fix`.
 *
 * @param {{dryRun: boolean, applied: object[], skipped: object[]}} [fixes] - Fix result.
 * @param {string} projectDir - Absolute scanned root.
 * @returns {string[]} Report lines.
 */
function formatFixSection(fixes, projectDir) {
  if (!fixes) return [];

  const lines = ['', 'Fixes'];
  const verb = fixes.dryRun ? 'Would apply' : 'Applied';

  if (!fixes.applied.length) {
    lines.push(`${verb} 0 fix(es).`);
  } else {
    lines.push(`${verb} ${fixes.applied.length} fix(es):`);
    for (const { finding, from, to } of fixes.applied) {
      const where = `${displayPath(projectDir, finding.filePath)}:${finding.line}`;
      lines.push(`  ${where}  ${from} -> ${to}`);
    }
  }

  if (fixes.skipped.length) {
    lines.push(`Skipped ${fixes.skipped.length} fixable finding(s):`);
    for (const { finding, reason } of fixes.skipped) {
      const where = `${displayPath(projectDir, finding.filePath)}:${finding.line}`;
      lines.push(`  ${where}  ${reason}`);
    }
  }

  return lines;
}

/**
 * Count findings by severity for machine-readable reports.
 *
 * @param {object[]} [findings=[]] - Findings to summarize.
 * @param {string} [defaultSeverity='warn'] - Severity for findings without one.
 * @returns {{error: number, warn: number, info: number}} Summary counts.
 */
export function summarizeFindings(findings = [], defaultSeverity = 'warn') {
  return findings.reduce(
    (summary, finding) => {
      const severity = summarySeverities.includes(finding.severity)
        ? finding.severity
        : defaultSeverity;

      if (summarySeverities.includes(severity)) {
        summary[severity] += 1;
      }

      return summary;
    },
    {
      error: 0,
      warn: 0,
      info: 0,
    },
  );
}

/**
 * Return the package identity recorded in machine-readable audit documents.
 *
 * @returns {{name: string, version: string}} Tool identity.
 */
function createToolIdentity() {
  return {
    name: corePackage.name,
    version: corePackage.version,
  };
}

/**
 * Remove the scanned absolute root from human-facing finding text.
 *
 * Internal checks may retain absolute paths. Machine-readable documents do not.
 *
 * @param {*} value - Finding text.
 * @param {string} projectDir - Absolute scanned root.
 * @returns {string} Portable text.
 */
function normalizeReportText(value, projectDir) {
  let text = String(value);
  const rootVariants = new Set([
    projectDir,
    projectDir.replaceAll('\\', '/'),
    projectDir.replaceAll('/', '\\'),
  ]);

  for (const root of rootVariants) {
    if (root) {
      text = text.replaceAll(root, '.');
    }
  }

  return text;
}

/**
 * Normalize one internal finding for the public JSON contract.
 *
 * @param {object} finding - Internal finding.
 * @param {string} projectDir - Absolute scanned root.
 * @param {string} defaultSeverity - Severity for unclassified findings.
 * @returns {object} Machine-readable finding.
 */
export function normalizeAuditFinding(
  finding,
  projectDir,
  defaultSeverity = 'warn',
) {
  if (typeof finding.id !== 'string' || !finding.id.trim()) {
    throw new TypeError('Audit finding is missing a non-empty "id".');
  }
  if (typeof finding.message !== 'string' || !finding.message.trim()) {
    throw new TypeError(
      `Audit finding "${finding.id}" is missing a non-empty "message".`,
    );
  }

  const severity = summarySeverities.includes(finding.severity)
    ? finding.severity
    : summarySeverities.includes(defaultSeverity)
      ? defaultSeverity
      : 'warn';
  const normalized = {
    id: finding.id,
    severity,
  };

  if (finding.filePath) {
    normalized.path = displayPath(projectDir, finding.filePath) || '.';
  }
  if (Number.isInteger(finding.line) && finding.line > 0) {
    normalized.line = finding.line;
  }

  normalized.message = normalizeReportText(finding.message, projectDir);

  if (Array.isArray(finding.details) && finding.details.length) {
    const details = finding.details
      .filter((detail) => detail != null)
      .map((detail) => normalizeReportText(detail, projectDir));
    if (details.length) {
      normalized.details = details;
    }
  }
  if (typeof finding.docs === 'string' && finding.docs) {
    normalized.docs = finding.docs;
  }

  return normalized;
}

/**
 * Normalize scan counts into the fixed schema-v1 shape.
 *
 * @param {object} [files={}] - Internal file counts.
 * @returns {{stories: number, twig: number, code: number, styles: number}}
 * File counts.
 */
function normalizeFileCounts(files = {}) {
  return Object.fromEntries(
    fileCountKeys.map((key) => [
      key,
      Number.isInteger(files[key]) && files[key] >= 0 ? files[key] : 0,
    ]),
  );
}

/**
 * Create the machine-readable audit report document.
 *
 * @param {{projectDir: string, files: object, findings: object[]}} result
 * Audit result.
 * @param {{defaultSeverity?: string}} [options={}] - Formatting options.
 * @returns {object} JSON report document.
 */
export function createAuditJsonReport(result, options = {}) {
  const findings = (result.findings || []).map((finding) =>
    normalizeAuditFinding(finding, result.projectDir, options.defaultSeverity),
  );

  const document = {
    schemaVersion: AUDIT_REPORT_SCHEMA_VERSION,
    tool: createToolIdentity(),
    root: '.',
    summary: summarizeFindings(findings),
    files: normalizeFileCounts(result.files),
    findings,
  };

  // Present only when --fix ran, so the document shape is unchanged for every
  // existing consumer.
  if (result.fixes) {
    document.fixes = normalizeFixes(result.fixes, result.projectDir);
  }

  return document;
}

/**
 * Normalize the autofix result for the machine-readable report.
 *
 * @param {{dryRun: boolean, applied: object[], skipped: object[]}} fixes - Fix result.
 * @param {string} projectDir - Absolute scanned root.
 * @returns {object} JSON fix block.
 */
function normalizeFixes(fixes, projectDir) {
  const locate = (finding) => ({
    path: displayPath(projectDir, finding.filePath) || '.',
    ...(Number.isInteger(finding.line) && finding.line > 0
      ? { line: finding.line }
      : {}),
  });

  return {
    dryRun: Boolean(fixes.dryRun),
    applied: fixes.applied.map(({ finding, from, to }) => ({
      ...locate(finding),
      from,
      to,
    })),
    skipped: fixes.skipped.map(({ finding, reason }) => ({
      ...locate(finding),
      reason,
    })),
  };
}

/**
 * Create a structured machine-readable CLI or audit failure.
 *
 * @param {*} error - Failure value.
 * @param {{code?: string, projectDir?: string}} [options={}] - Error options.
 * @returns {object} JSON error document.
 */
export function createAuditJsonErrorReport(error, options = {}) {
  const message = error?.message || error;

  return {
    schemaVersion: AUDIT_REPORT_SCHEMA_VERSION,
    tool: createToolIdentity(),
    error: {
      code: options.code || 'audit-failed',
      message: normalizeReportText(message, options.projectDir || ''),
    },
  };
}

/**
 * Format the audit report as machine-readable JSON.
 *
 * @param {{projectDir: string, files: object, findings: object[]}} result
 * Audit result.
 * @param {{defaultSeverity?: string}} [options={}] - Options.
 * @returns {string} JSON report.
 */
export function formatAuditJsonReport(result, options = {}) {
  return JSON.stringify(createAuditJsonReport(result, options), null, 2);
}

/**
 * Format a CLI or audit failure as machine-readable JSON.
 *
 * @param {*} error - Failure value.
 * @param {{code?: string, projectDir?: string}} [options={}] - Error options.
 * @returns {string} JSON error document.
 */
export function formatAuditJsonErrorReport(error, options = {}) {
  return JSON.stringify(createAuditJsonErrorReport(error, options), null, 2);
}
