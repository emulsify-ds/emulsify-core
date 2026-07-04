/**
 * @file Report formatting for the project audit.
 */

import { createRequire } from 'node:module';
import { displayPath } from './lib/findings.js';

const require = createRequire(import.meta.url);
const corePackage = require('../../package.json');
const summarySeverities = ['error', 'warn', 'info'];

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
    return lines.join('\n');
  }

  for (const finding of result.findings) {
    lines.push('', ...formatFinding(finding, result.projectDir));
  }

  return lines.join('\n');
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
 * Create the machine-readable audit report document.
 *
 * @param {{projectDir: string, findings: object[]}} result - Audit result.
 * @param {{defaultSeverity?: string, version?: string}} [options={}] - Options.
 * @returns {{version: string, projectDir: string, summary: object, findings: object[]}}
 * JSON report document.
 */
export function createAuditJsonReport(result, options = {}) {
  const findings = result.findings || [];

  return {
    version: options.version || corePackage.version,
    projectDir: result.projectDir,
    summary: summarizeFindings(findings, options.defaultSeverity),
    findings,
  };
}

/**
 * Format the audit report as machine-readable JSON.
 *
 * @param {{projectDir: string, findings: object[]}} result - Audit result.
 * @param {{defaultSeverity?: string, version?: string}} [options={}] - Options.
 * @returns {string} JSON report.
 */
export function formatAuditJsonReport(result, options = {}) {
  return JSON.stringify(createAuditJsonReport(result, options), null, 2);
}
