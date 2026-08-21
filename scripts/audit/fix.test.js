/**
 * @file Tests for audit autofix application.
 */

import fs, { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { applyAuditFixes, remainingFindings } from './fix.js';
import { auditCssAssetReferences } from './checks/css-asset-references.js';
import { resetFileReadCache } from './lib/files.js';
import { makeTempProject, removeTempProject, writeFile } from './test-utils.js';
import { runCli as runAuditCli } from '../audit.js';

// The lint rule bans double-quoted strings, and these fixtures need a literal
// single quote to exercise CSS quote handling.
const QUOTE = String.fromCharCode(39);

describe('applyAuditFixes', () => {
  let projectDir;
  let externalDir;

  beforeEach(() => {
    projectDir = makeTempProject();
    externalDir = undefined;
    resetFileReadCache();
  });

  afterEach(() => {
    removeTempProject(projectDir);
    if (externalDir) removeTempProject(externalDir);
    jest.restoreAllMocks();
  });

  const auditStyles = (styleFile, projectStructure = {}) =>
    auditCssAssetReferences({
      env: { projectDir, projectStructure },
      projectDir,
      styleFiles: [styleFile],
    });

  const apply = (findings, options = {}) =>
    applyAuditFixes(findings, { projectDir, ...options });

  const writeConfiguredProject = () =>
    writeFile(
      projectDir,
      'project.emulsify.json',
      JSON.stringify({
        project: {
          platform: 'none',
          name: 'Audit fixture',
          machineName: 'audit_fixture',
        },
      }),
    );

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

    const result = apply(auditStyles(styleFile));

    expect(result.applied).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).not.toBe(styleFile);
    expect(dirname(spy.mock.calls[0][0])).toBe(
      fs.realpathSync(dirname(styleFile)),
    );
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

    apply(auditStyles(styleFile));

    expect(readFileSync(styleFile, 'utf8')).toBe(
      [
        `.a { background: url(${QUOTE}/assets/a.svg?v=2${QUOTE}); }`,
        '.b { background: url(/assets/a.svg); }',
      ].join('\n'),
    );
  });

  it('skips a non-UTF-8 source file without changing any bytes', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const original = Buffer.concat([
      Buffer.from('.caf'),
      Buffer.from([0xe9]),
      Buffer.from(' { background: url("assets/a.svg"); }'),
    ]);
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      original,
    );
    const findings = auditStyles(styleFile);

    const result = apply(findings);

    expect(findings).toHaveLength(1);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([
      {
        finding: findings[0],
        reason: 'file is not valid UTF-8; left unchanged',
      },
    ]);
    expect(result.skipped[0].finding.filePath).toBe(styleFile);
    expect(readFileSync(styleFile)).toEqual(original);
  });

  it('preserves a UTF-8 BOM and CRLF line endings', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const original = Buffer.from(
      '\uFEFF.a { background: url("assets/a.svg"); }\r\n.b { color: red; }\r\n',
      'utf8',
    );
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      original,
    );

    const result = apply(auditStyles(styleFile));

    expect(result.applied).toHaveLength(1);
    expect(readFileSync(styleFile)).toEqual(
      Buffer.from(
        '\uFEFF.a { background: url("/assets/a.svg"); }\r\n.b { color: red; }\r\n',
        'utf8',
      ),
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

    const result = apply(auditStyles(styleFile), { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.applied).toHaveLength(1);
    expect(readFileSync(styleFile, 'utf8')).toBe(before);
    expect(statSync(styleFile).mtimeMs).toBe(mtimeBefore);
  });

  it('skips a symlink whose real target escapes the scanned root', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    externalDir = makeTempProject();
    const externalStyle = writeFile(
      externalDir,
      'shared.scss',
      '.card { background: url("../assets/a.svg"); }',
    );
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '',
    );
    fs.unlinkSync(styleFile);
    fs.symlinkSync(externalStyle, styleFile);
    const original = readFileSync(externalStyle);
    const findings = auditStyles(styleFile);
    const realTarget = fs.realpathSync(externalStyle);

    const result = apply(findings);

    expect(findings).toHaveLength(1);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([
      {
        finding: findings[0],
        reason: `real target is outside scanned root: ${realTarget}`,
      },
    ]);
    expect(readFileSync(externalStyle)).toEqual(original);
    expect(fs.lstatSync(styleFile).isSymbolicLink()).toBe(true);
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

    const result = apply(findings);

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

    const result = apply(findings);

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

    apply(auditStyles(styleFile));

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

    let failure;
    try {
      apply(findings);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeDefined();
    expect(failure.message).toContain('EACCES');
    expect(failure.fixes.applied).toEqual([]);
    expect(readFileSync(styleFile, 'utf8')).toContain('url("../assets/a.svg")');
  });

  it('does not overwrite source changed before the atomic rename', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background: url("../assets/a.svg"); }',
    );
    const findings = auditStyles(styleFile);
    const concurrentSource = '.card { color: rebeccapurple; }';
    const originalWrite = fs.writeFileSync;
    jest.spyOn(fs, 'writeFileSync').mockImplementation((...args) => {
      const result = originalWrite(...args);
      originalWrite(styleFile, concurrentSource);
      return result;
    });

    let failure;
    try {
      apply(findings);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeDefined();
    expect(failure.message).toContain(
      'source changed while applying audit fixes',
    );
    expect(failure.fixes.applied).toEqual([]);
    expect(readFileSync(styleFile, 'utf8')).toBe(concurrentSource);
    expect(
      fs
        .readdirSync(dirname(styleFile))
        .filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
  });

  it('reports files rewritten before a later atomic replacement fails', () => {
    writeConfiguredProject();
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    writeFile(projectDir, 'assets/b.svg', '<svg />');
    const firstStyle = writeFile(
      projectDir,
      'src/components/a/a.scss',
      '.a { background: url("assets/a.svg"); }',
    );
    const secondStyle = writeFile(
      projectDir,
      'src/components/b/b.scss',
      '.b { background: url("assets/b.svg"); }',
    );
    const realSecondStyle = fs.realpathSync(secondStyle);
    const originalRename = fs.renameSync;
    jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === realSecondStyle) {
        const error = new Error('simulated EACCES');
        error.code = 'EACCES';
        throw error;
      }
      return originalRename(from, to);
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const exitCode = runAuditCli(['--root', projectDir, '--fix']);
    const report = errorSpy.mock.calls[0][0];

    expect(exitCode).toBe(2);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(report).toContain('Applied 1 fix(es) across 1 file(s)');
    expect(report).toContain('src/components/a/a.scss');
    expect(report).toContain('Audit fix failed:');
    expect(report).toContain('simulated EACCES');
    expect(readFileSync(firstStyle, 'utf8')).toContain('url("/assets/a.svg")');
    expect(readFileSync(secondStyle, 'utf8')).toContain('url("assets/b.svg")');
    expect(
      fs
        .readdirSync(dirname(secondStyle))
        .filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
    expect(auditStyles(firstStyle)).toEqual([]);
  });

  it('reports only remaining findings and summary values after --fix', () => {
    writeConfiguredProject();
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const source = [
      '.fixed { background: url("assets/a.svg"); }',
      '.missing { background: url("/assets/missing.svg"); }',
    ].join('\n');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      source,
    );
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const textExitCode = runAuditCli([
      '--root',
      projectDir,
      '--fix',
      '--fail-on',
      'warn',
    ]);
    const textReport = logSpy.mock.calls[0][0];

    expect(textExitCode).toBe(1);
    expect(textReport).toContain(
      'Findings: 0 error(s), 1 warning(s), 0 info item(s).',
    );
    expect(textReport).not.toContain('[info] css-runtime-asset-reference');

    writeFileSync(styleFile, source);
    const jsonExitCode = runAuditCli([
      '--root',
      projectDir,
      '--fix',
      '--json',
      '--fail-on',
      'warn',
    ]);
    const report = JSON.parse(logSpy.mock.calls[1][0]);

    expect(jsonExitCode).toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(report.summary).toEqual({ error: 0, warn: 1, info: 0 });
    expect(report.findings).toEqual([
      expect.objectContaining({
        id: 'unresolved-css-asset-reference',
        severity: 'warn',
      }),
    ]);
    expect(report.fixes.applied).toEqual([
      expect.objectContaining({
        path: 'src/components/card/card.scss',
        from: 'assets/a.svg',
        to: '/assets/a.svg',
      }),
    ]);
    expect(readFileSync(styleFile, 'utf8')).toContain('url("/assets/a.svg")');
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

    apply(auditStyles(styleFile));
    writeFileSync(styleFile, '.card { background: url("assets/a.svg"); }');

    expect(auditStyles(styleFile)).toHaveLength(1);
  });
});
