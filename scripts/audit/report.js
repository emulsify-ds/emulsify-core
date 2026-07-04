/**
 * @file Report formatting for the project audit.
 */

import { displayPath } from './lib/findings.js';

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
