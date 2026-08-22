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
const posixIt = process.platform === 'win32' ? it.skip : it;

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
    const findings = auditStyles(styleFile);
    const openSpy = jest.spyOn(fs, 'openSync');
    const writeSpy = jest.spyOn(fs, 'writeFileSync');

    const result = apply(findings);
    const temporaryOpenIndex = openSpy.mock.calls.findIndex(
      ([, flags]) => flags === 'wx',
    );

    expect(temporaryOpenIndex).toBeGreaterThanOrEqual(0);

    const temporaryPath = openSpy.mock.calls[temporaryOpenIndex][0];
    const temporaryHandle = openSpy.mock.results[temporaryOpenIndex].value;

    expect(result.applied).toHaveLength(2);
    expect(temporaryPath).not.toBe(styleFile);
    expect(dirname(temporaryPath)).toBe(fs.realpathSync(dirname(styleFile)));
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith(temporaryHandle, expect.any(Buffer));
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
    const externalSource = '.card { background: url("../assets/a.svg"); }';
    const externalStyle = writeFile(externalDir, 'shared.scss', externalSource);
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

    expect(findings).toHaveLength(1);

    // Advice is suppressed for non-writable sources, so synthesize the stale
    // payload an API caller could still pass to cover apply-time containment.
    const originalSpecifier = '../assets/a.svg';
    const start = externalSource.indexOf(originalSpecifier);
    findings[0].fix = {
      filePath: styleFile,
      start,
      end: start + originalSpecifier.length,
      original: originalSpecifier,
      replacement: '/assets/a.svg',
    };

    const result = apply(findings);

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

  it('does not remove a temp path it failed to create exclusively', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const original = '.card { background: url("../assets/a.svg"); }';
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      original,
    );
    const findings = auditStyles(styleFile);
    const originalOpen = fs.openSync;
    const originalWrite = fs.writeFileSync;
    let foreignTempPath;

    jest.spyOn(fs, 'openSync').mockImplementation((filePath, flags, mode) => {
      if (flags === 'wx') {
        foreignTempPath = filePath;
        originalWrite(filePath, 'created by another process');
        throw Object.assign(new Error('simulated EEXIST'), {
          code: 'EEXIST',
        });
      }
      return originalOpen(filePath, flags, mode);
    });

    expect(() => apply(findings)).toThrow('simulated EEXIST');
    expect(readFileSync(foreignTempPath, 'utf8')).toBe(
      'created by another process',
    );
    expect(readFileSync(styleFile, 'utf8')).toBe(original);
    fs.unlinkSync(foreignTempPath);
  });

  posixIt('preserves file ownership through an atomic replacement', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background: url("../assets/a.svg"); }',
    );
    // Reproduce the container failure when the suite itself runs as root: the
    // bind-mounted source belongs to the host user, not to the fixer process.
    if (process.platform !== 'win32' && process.getuid?.() === 0) {
      fs.chownSync(styleFile, 1000, 1000);
    }
    const ownershipBefore = statSync(styleFile);
    const fchownSpy = jest.spyOn(fs, 'fchownSync');
    const fchmodSpy = jest.spyOn(fs, 'fchmodSync');

    const result = apply(auditStyles(styleFile));
    const ownershipAfter = statSync(styleFile);

    expect(result.applied).toHaveLength(1);
    expect(fchownSpy).toHaveBeenCalledWith(
      expect.any(Number),
      ownershipBefore.uid,
      ownershipBefore.gid,
    );
    expect(fchownSpy.mock.invocationCallOrder[0]).toBeLessThan(
      fchmodSpy.mock.invocationCallOrder[0],
    );
    expect({ uid: ownershipAfter.uid, gid: ownershipAfter.gid }).toEqual({
      uid: ownershipBefore.uid,
      gid: ownershipBefore.gid,
    });
  });

  posixIt('preserves target mode after changing temp-file ownership', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background: url("../assets/a.svg"); }',
    );
    fs.chmodSync(styleFile, 0o640);

    const result = apply(auditStyles(styleFile));

    expect(result.applied).toHaveLength(1);
    expect(statSync(styleFile).mode & 0o7777).toBe(0o640);
  });

  posixIt(
    'tolerates EPERM when the temporary file already has the right owner',
    () => {
      writeFile(projectDir, 'assets/a.svg', '<svg />');
      const styleFile = writeFile(
        projectDir,
        'src/components/card/card.scss',
        '.card { background: url("../assets/a.svg"); }',
      );
      const permissionError = Object.assign(new Error('simulated EPERM'), {
        code: 'EPERM',
      });
      jest.spyOn(fs, 'fchownSync').mockImplementation(() => {
        throw permissionError;
      });
      const fstatSpy = jest.spyOn(fs, 'fstatSync');

      const result = apply(auditStyles(styleFile));

      expect(result.applied).toHaveLength(1);
      expect(fstatSpy).toHaveBeenCalled();
      expect(readFileSync(styleFile, 'utf8')).toContain('url("/assets/a.svg")');
      expect(
        fs
          .readdirSync(dirname(styleFile))
          .filter((name) => name.endsWith('.tmp')),
      ).toEqual([]);
    },
  );

  posixIt('does not ignore EPERM when the temporary file owner differs', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const original = '.card { background: url("../assets/a.svg"); }';
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      original,
    );
    const targetOwnership = statSync(styleFile);
    const permissionError = Object.assign(new Error('simulated EPERM'), {
      code: 'EPERM',
    });
    jest.spyOn(fs, 'fchownSync').mockImplementation(() => {
      throw permissionError;
    });
    jest.spyOn(fs, 'fstatSync').mockReturnValue({
      uid: targetOwnership.uid + 1,
      gid: targetOwnership.gid,
    });

    let failure;
    try {
      apply(auditStyles(styleFile));
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeDefined();
    expect(failure.code).toBe('EPERM');
    expect(failure.fixes.applied).toEqual([]);
    expect(readFileSync(styleFile, 'utf8')).toBe(original);
    expect(
      fs
        .readdirSync(dirname(styleFile))
        .filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
  });

  posixIt(
    'fails atomically and removes its temp file on other chown errors',
    () => {
      writeFile(projectDir, 'assets/a.svg', '<svg />');
      const original = '.card { background: url("../assets/a.svg"); }';
      const styleFile = writeFile(
        projectDir,
        'src/components/card/card.scss',
        original,
      );
      const ownershipError = Object.assign(new Error('simulated EIO'), {
        code: 'EIO',
      });
      jest.spyOn(fs, 'fchownSync').mockImplementation(() => {
        throw ownershipError;
      });
      const closeSpy = jest.spyOn(fs, 'closeSync');

      let failure;
      try {
        apply(auditStyles(styleFile));
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeDefined();
      expect(failure.code).toBe('EIO');
      expect(failure.fixes.applied).toEqual([]);
      expect(closeSpy).toHaveBeenCalled();
      expect(readFileSync(styleFile, 'utf8')).toBe(original);
      expect(
        fs
          .readdirSync(dirname(styleFile))
          .filter((name) => name.endsWith('.tmp')),
      ).toEqual([]);
    },
  );

  it('refuses to replace a target without write access', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const original = '.card { background: url("../assets/a.svg"); }';
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      original,
    );
    const findings = auditStyles(styleFile);
    const realTarget = fs.realpathSync(styleFile);
    const accessError = Object.assign(new Error('simulated EACCES'), {
      code: 'EACCES',
    });
    const originalAccess = fs.accessSync;
    jest.spyOn(fs, 'accessSync').mockImplementation((filePath, mode) => {
      if (filePath === realTarget && mode === fs.constants.W_OK) {
        throw accessError;
      }
      return originalAccess(filePath, mode);
    });
    const openSpy = jest.spyOn(fs, 'openSync');

    const result = apply(findings);

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([
      {
        finding: findings[0],
        reason: `real target is not writable: ${realTarget}`,
      },
    ]);
    expect(openSpy).not.toHaveBeenCalled();
    expect(readFileSync(styleFile, 'utf8')).toBe(original);
  });

  it('refuses to replace a target in a directory without write access', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const original = '.card { background: url("../assets/a.svg"); }';
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      original,
    );
    const findings = auditStyles(styleFile);
    const realDirectory = fs.realpathSync(dirname(styleFile));
    const accessError = Object.assign(new Error('simulated EACCES'), {
      code: 'EACCES',
    });
    const originalAccess = fs.accessSync;
    jest.spyOn(fs, 'accessSync').mockImplementation((filePath, mode) => {
      if (
        filePath === realDirectory &&
        mode === (fs.constants.W_OK | fs.constants.X_OK)
      ) {
        throw accessError;
      }
      return originalAccess(filePath, mode);
    });
    const openSpy = jest.spyOn(fs, 'openSync');

    const result = apply(findings);

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([
      {
        finding: findings[0],
        reason: `real target directory is not writable: ${realDirectory}`,
      },
    ]);
    expect(openSpy).not.toHaveBeenCalled();
    expect(readFileSync(styleFile, 'utf8')).toBe(original);
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

  it('does not undo a concurrent target mode change', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const original = '.card { background: url("../assets/a.svg"); }';
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      original,
    );
    const findings = auditStyles(styleFile);
    const concurrentMode = 0o600;
    const originalWrite = fs.writeFileSync;
    jest.spyOn(fs, 'writeFileSync').mockImplementation((...args) => {
      const result = originalWrite(...args);
      fs.chmodSync(styleFile, concurrentMode);
      return result;
    });

    expect(() => apply(findings)).toThrow(
      'source metadata changed while applying audit fixes',
    );
    expect(readFileSync(styleFile, 'utf8')).toBe(original);
    expect(statSync(styleFile).mode & 0o777).toBe(concurrentMode);
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
