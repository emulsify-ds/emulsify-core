/**
 * @file Tests for the stable machine-readable audit report contract.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  AUDIT_REPORT_SCHEMA_VERSION,
  createAuditJsonErrorReport,
  createAuditJsonReport,
  formatAuditJsonReport,
} from './report.js';

const require = createRequire(import.meta.url);
const corePackage = require('../../package.json');

describe('audit JSON report contract', () => {
  const projectDir = join(process.cwd(), 'test-fixtures', 'audit-project');

  it('emits the fixed schema-v1 envelope and zero-valued scan metadata', () => {
    const report = createAuditJsonReport({
      projectDir,
      files: {},
      findings: [],
    });

    expect(Object.keys(report)).toEqual([
      'schemaVersion',
      'tool',
      'root',
      'summary',
      'files',
      'findings',
    ]);
    expect(report).toEqual({
      schemaVersion: AUDIT_REPORT_SCHEMA_VERSION,
      tool: {
        name: corePackage.name,
        version: corePackage.version,
      },
      root: '.',
      summary: {
        error: 0,
        warn: 0,
        info: 0,
      },
      files: {
        stories: 0,
        twig: 0,
        code: 0,
        styles: 0,
      },
      findings: [],
    });
  });

  it('normalizes finding severities, optional fields, and portable paths', () => {
    const report = createAuditJsonReport({
      projectDir,
      files: {
        stories: 1,
        twig: 2,
        code: 3,
        styles: 4,
      },
      findings: [
        {
          id: 'example-error',
          severity: 'error',
          filePath: join(projectDir, 'src', 'components', 'card', 'card.twig'),
          line: 12,
          message: `Unable to process ${projectDir}`,
          details: [`Scanned from ${projectDir}`],
          docs: 'https://example.com/audit',
        },
        {
          id: 'example-warn',
          severity: 'warn',
          message: 'Warning example.',
          docs: undefined,
        },
        {
          id: 'example-info',
          severity: 'info',
          message: 'Information example.',
          details: [],
        },
      ],
    });

    expect(report.summary).toEqual({
      error: 1,
      warn: 1,
      info: 1,
    });
    expect(report.files).toEqual({
      stories: 1,
      twig: 2,
      code: 3,
      styles: 4,
    });
    expect(report.findings[0]).toEqual({
      id: 'example-error',
      severity: 'error',
      path: 'src/components/card/card.twig',
      line: 12,
      message: 'Unable to process .',
      details: ['Scanned from .'],
      docs: 'https://example.com/audit',
    });
    expect(Object.keys(report.findings[0])).toEqual([
      'id',
      'severity',
      'path',
      'line',
      'message',
      'details',
      'docs',
    ]);
    expect(report.findings[1]).toEqual({
      id: 'example-warn',
      severity: 'warn',
      message: 'Warning example.',
    });
    expect(report.findings[2]).toEqual({
      id: 'example-info',
      severity: 'info',
      message: 'Information example.',
    });

    const formatted = formatAuditJsonReport({
      projectDir,
      files: report.files,
      findings: [
        {
          id: 'stable-order',
          severity: 'warn',
          message: 'Stable output.',
        },
      ],
    });

    expect(formatted).toBe(
      JSON.stringify(
        createAuditJsonReport({
          projectDir,
          files: report.files,
          findings: [
            {
              id: 'stable-order',
              severity: 'warn',
              message: 'Stable output.',
            },
          ],
        }),
        null,
        2,
      ),
    );
    expect(JSON.stringify(report)).not.toContain(projectDir);
  });

  it('uses a distinct structured document for CLI and setup failures', () => {
    const report = createAuditJsonErrorReport(
      new Error(`Unable to scan ${projectDir}`),
      {
        code: 'audit-failed',
        projectDir,
      },
    );

    expect(Object.keys(report)).toEqual(['schemaVersion', 'tool', 'error']);
    expect(report).toEqual({
      schemaVersion: AUDIT_REPORT_SCHEMA_VERSION,
      tool: {
        name: corePackage.name,
        version: corePackage.version,
      },
      error: {
        code: 'audit-failed',
        message: 'Unable to scan .',
      },
    });
    expect(JSON.stringify(report)).not.toContain(projectDir);
  });
});
