/**
 * @file Tests for audit autofix application.
 */

import fs, { readFileSync, statSync, writeFileSync } from 'node:fs';

import { applyAuditFixes, remainingFindings } from './fix.js';
import { auditCssAssetReferences } from './checks/css-asset-references.js';
import { resetFileReadCache } from './lib/files.js';
import { makeTempProject, removeTempProject, writeFile } from './test-utils.js';

// The lint rule bans double-quoted strings, and these fixtures need a literal
// single quote to exercise CSS quote handling.
const QUOTE = String.fromCharCode(39);

describe('applyAuditFixes', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
    resetFileReadCache();
  });

  afterEach(() => {
    removeTempProject(projectDir);
    jest.restoreAllMocks();
  });

  const auditStyles = (styleFile, projectStructure = {}) =>
    auditCssAssetReferences({
      env: { projectDir, projectStructure },
      projectDir,
      styleFiles: [styleFile],
    });

  it('fixes two URLs on one line in a single write', () => {
    // Edits are applied descending by offset, so the second one cannot shift
    // the first out from under itself.
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    writeFile(projectDir, 'assets/b.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background: url("assets/a.svg"); mask: url("../assets/b.svg"); }',
    );
    const spy = jest.spyOn(fs, 'writeFileSync');

    const result = applyAuditFixes(auditStyles(styleFile));

    expect(result.applied).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(readFileSync(styleFile, 'utf8')).toBe(
      '.card { background: url("/assets/a.svg"); mask: url("/assets/b.svg"); }',
    );
  });

  it('preserves quote style and a query suffix', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      [
        `.a { background: url(${QUOTE}../assets/a.svg?v=2${QUOTE}); }`,
        '.b { background: url(../assets/a.svg); }',
      ].join('\n'),
    );

    applyAuditFixes(auditStyles(styleFile));

    expect(readFileSync(styleFile, 'utf8')).toBe(
      [
        `.a { background: url(${QUOTE}/assets/a.svg?v=2${QUOTE}); }`,
        '.b { background: url(/assets/a.svg); }',
      ].join('\n'),
    );
  });

  it('writes nothing under a dry run', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background: url("../assets/a.svg"); }',
    );
    const before = readFileSync(styleFile, 'utf8');
    const mtimeBefore = statSync(styleFile).mtimeMs;

    const result = applyAuditFixes(auditStyles(styleFile), { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.applied).toHaveLength(1);
    expect(readFileSync(styleFile, 'utf8')).toBe(before);
    expect(statSync(styleFile).mtimeMs).toBe(mtimeBefore);
  });

  it('skips a fix whose source moved and keeps its siblings', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    writeFile(projectDir, 'assets/b.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      [
        '.a { background: url("../assets/a.svg"); }',
        '.b { background: url("../assets/b.svg"); }',
      ].join('\n'),
    );
    const findings = auditStyles(styleFile);

    // Simulate a stale offset rather than a stale file, so only one entry is
    // affected and the other must still land.
    findings[0].fix.original = 'not-what-is-there';

    const result = applyAuditFixes(findings);

    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toEqual([
      { finding: findings[0], reason: 'source no longer matches' },
    ]);
    expect(readFileSync(styleFile, 'utf8')).toContain('url("../assets/a.svg")');
    expect(readFileSync(styleFile, 'utf8')).toContain('url("/assets/b.svg")');
  });

  it('leaves findings without a fix payload untouched', () => {
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background: url("./missing.svg"); }',
    );
    const findings = auditStyles(styleFile);

    const result = applyAuditFixes(findings);

    expect(result.applied).toEqual([]);
    expect(remainingFindings(findings, result.applied)).toEqual(findings);
  });

  it('reports zero findings when the audit is re-run on fixed source', () => {
    // The idempotence claim that lets --fix turn a failing audit green: the
    // findings it removed really are gone from the file.
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background: url("../assets/a.svg"); }',
    );

    applyAuditFixes(auditStyles(styleFile));

    expect(auditStyles(styleFile)).toEqual([]);
  });

  it('surfaces a write failure rather than reporting a phantom fix', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background: url("../assets/a.svg"); }',
    );
    const findings = auditStyles(styleFile);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('EACCES');
    });

    expect(() => applyAuditFixes(findings)).toThrow('EACCES');
  });

  it('drops the read cache after writing', () => {
    // A warm cache would make the next scan report findings that no longer
    // exist in the file.
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background: url("../assets/a.svg"); }',
    );

    applyAuditFixes(auditStyles(styleFile));
    writeFileSync(styleFile, '.card { background: url("assets/a.svg"); }');

    expect(auditStyles(styleFile)).toHaveLength(1);
  });
});
