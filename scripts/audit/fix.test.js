/**
 * @file Tests for audit autofix application.
 */

import fs, { readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';

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

    const result = apply(findings);

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([
      {
        finding: findings[0],
        reason: 'unable to rewrite file: EACCES',
      },
    ]);
    expect(remainingFindings(findings, result.applied)).toEqual(findings);
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

    const result = apply(findings);

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([
      {
        finding: findings[0],
        reason: 'unable to rewrite file: simulated EEXIST',
      },
    ]);
    expect(readFileSync(foreignTempPath, 'utf8')).toBe(
      'created by another process',
    );
    expect(readFileSync(styleFile, 'utf8')).toBe(original);
    fs.unlinkSync(foreignTempPath);
  });

  it('bounds temporary filenames by UTF-8 bytes', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const longBasename = `${'é'.repeat(120)}.scss`;
    const styleFile = writeFile(
      projectDir,
      `src/components/card/${longBasename}`,
      '.card { background: url("../assets/a.svg"); }',
    );
    const openSpy = jest.spyOn(fs, 'openSync');

    const result = apply(auditStyles(styleFile));
    const temporaryPath = openSpy.mock.calls.find(
      ([, flags]) => flags === 'wx',
    )[0];

    expect(result.applied).toHaveLength(1);
    expect(Buffer.byteLength(basename(temporaryPath))).toBeLessThanOrEqual(255);
    expect(readFileSync(styleFile, 'utf8')).toContain('url("/assets/a.svg")');
  });

  it('does not report or remove a phantom temp after ENAMETOOLONG', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background: url("../assets/a.svg"); }',
    );
    const findings = auditStyles(styleFile);
    let temporaryPath;

    const originalOpen = fs.openSync;
    jest.spyOn(fs, 'openSync').mockImplementation((filePath, flags, mode) => {
      if (flags === 'wx') {
        temporaryPath = filePath;
        throw Object.assign(new Error('simulated ENAMETOOLONG'), {
          code: 'ENAMETOOLONG',
        });
      }
      return originalOpen(filePath, flags, mode);
    });
    const unlinkSpy = jest.spyOn(fs, 'unlinkSync');

    const result = apply(findings);

    expect(result.applied).toEqual([]);
    expect(result.skipped[0].reason).toContain('simulated ENAMETOOLONG');
    expect(result.skipped[0].reason).not.toContain(
      'unable to remove temporary file',
    );
    expect(unlinkSpy).not.toHaveBeenCalledWith(temporaryPath);
    expect(fs.existsSync(temporaryPath)).toBe(false);
  });

  it.each([
    ['exit', 'onTemporaryCleanupExit', undefined],
    ['SIGINT', 'onTemporaryCleanupSigint', 'SIGINT'],
    ['SIGTERM', 'onTemporaryCleanupSigterm', 'SIGTERM'],
  ])('removes an active temp on %s', (event, handlerName, expectedSignal) => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '.card { background: url("../assets/a.svg"); }',
    );
    const findings = auditStyles(styleFile);
    const originalOpen = fs.openSync;
    const originalWrite = fs.writeFileSync;
    const processListeners = process.listeners.bind(process);
    let temporaryPath;

    const removeListenerSpy = jest.spyOn(process, 'removeListener');
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    jest.spyOn(fs, 'openSync').mockImplementation((filePath, flags, mode) => {
      if (flags === 'wx') temporaryPath = filePath;
      return originalOpen(filePath, flags, mode);
    });
    jest.spyOn(fs, 'writeFileSync').mockImplementation((...args) => {
      originalWrite(...args);
      const handler = processListeners(event).find(
        (listener) => listener.name === handlerName,
      );
      expect(handler).toBeDefined();
      const listenersSpy = expectedSignal
        ? jest
            .spyOn(process, 'listeners')
            .mockImplementation((name) =>
              name === event ? [handler] : processListeners(name),
            )
        : undefined;
      handler();
      listenersSpy?.mockRestore();
      throw new Error(`simulated ${event}`);
    });

    const result = apply(findings);

    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(fs.existsSync(temporaryPath)).toBe(false);
    expect(removeListenerSpy).toHaveBeenCalledWith(
      'exit',
      expect.any(Function),
    );
    expect(removeListenerSpy).toHaveBeenCalledWith(
      'SIGINT',
      expect.any(Function),
    );
    expect(removeListenerSpy).toHaveBeenCalledWith(
      'SIGTERM',
      expect.any(Function),
    );
    if (expectedSignal) {
      expect(killSpy).toHaveBeenCalledWith(process.pid, expectedSignal);
    } else {
      expect(killSpy).not.toHaveBeenCalled();
    }
  });

  posixIt('re-raises a signal queued during synchronous temp I/O', () => {
    const source = '.card { background: url("../assets/a.svg"); }';
    const original = '../assets/a.svg';
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      source,
    );
    const moduleUrl = new URL('./fix.js', import.meta.url).href;
    const childScript = `
      import fs from 'node:fs';
      import { applyAuditFixes } from ${JSON.stringify(moduleUrl)};

      const projectDir = ${JSON.stringify(projectDir)};
      const styleFile = ${JSON.stringify(styleFile)};
      const source = ${JSON.stringify(source)};
      const original = ${JSON.stringify(original)};
      const start = source.indexOf(original);
      const finding = {
        id: 'css-runtime-asset-reference',
        severity: 'info',
        filePath: styleFile,
        line: 1,
        fix: {
          filePath: styleFile,
          start,
          end: start + original.length,
          original,
          replacement: '/assets/a.svg',
        },
      };
      const writeFileSync = fs.writeFileSync;

      fs.writeFileSync = (...args) => {
        const result = writeFileSync(...args);
        process.kill(process.pid, 'SIGINT');
        const waitUntil = Date.now() + 50;
        while (Date.now() < waitUntil) {}
        return result;
      };

      applyAuditFixes([finding], {
        projectDir,
        sourceRoots: [${JSON.stringify(join(projectDir, 'src'))}],
      });
    `;

    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', childScript],
      { encoding: 'utf8', timeout: 5000 },
    );

    expect(child.error).toBeUndefined();
    expect(child.signal).toBe('SIGINT');
    expect(
      fs
        .readdirSync(dirname(styleFile))
        .filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
  });

  it('sweeps stale fix temps but preserves live and unrelated files', () => {
    const stalePid = 2147483646;
    const uuid = '00000000-0000-4000-8000-000000000000';
    const stalePath = writeFile(
      projectDir,
      `src/components/card/.card.scss.${stalePid}.${uuid}.tmp`,
      'stale',
    );
    const livePath = writeFile(
      projectDir,
      `src/components/card/.card.scss.${process.pid}.${uuid}.tmp`,
      'live',
    );
    const unrelatedPath = writeFile(
      projectDir,
      'src/components/card/.card.scss.not-a-fix.tmp',
      'unrelated',
    );
    const dryRunPath = writeFile(
      projectDir,
      `src/components/card/.dry.scss.${stalePid}.${uuid}.tmp`,
      'dry run',
    );
    jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === stalePid && signal === 0) {
        throw Object.assign(new Error('process is gone'), { code: 'ESRCH' });
      }
      return true;
    });

    apply([], { dryRun: true, sourceRoots: [join(projectDir, 'src')] });

    expect(fs.existsSync(dryRunPath)).toBe(true);

    apply([], { sourceRoots: [join(projectDir, 'src')] });

    expect(fs.existsSync(stalePath)).toBe(false);
    expect(fs.existsSync(dryRunPath)).toBe(false);
    expect(readFileSync(livePath, 'utf8')).toBe('live');
    expect(readFileSync(unrelatedPath, 'utf8')).toBe('unrelated');
  });

  it.each(['dist', 'node_modules/package'])(
    'does not sweep ignored files when %s is configured as a source root',
    (ignoredRoot) => {
      const stalePid = 2147483646;
      const stalePath = writeFile(
        projectDir,
        `${ignoredRoot}/.card.scss.${stalePid}.00000000-0000-4000-8000-000000000000.tmp`,
        'ignored',
      );
      jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
        if (pid === stalePid && signal === 0) {
          throw Object.assign(new Error('process is gone'), { code: 'ESRCH' });
        }
        return true;
      });

      apply([], { sourceRoots: [join(projectDir, ignoredRoot)] });

      expect(readFileSync(stalePath, 'utf8')).toBe('ignored');
    },
  );

  posixIt(
    'revalidates stale-temp containment immediately before unlink',
    () => {
      const stalePid = 2147483646;
      const relativeTemp = `components/card/.card.scss.${stalePid}.00000000-0000-4000-8000-000000000000.tmp`;
      const sourceRoot = join(projectDir, 'src');
      const movedSourceRoot = join(projectDir, 'src-before-swap');
      const originalTemp = writeFile(
        projectDir,
        `src/${relativeTemp}`,
        'inside',
      );
      externalDir = makeTempProject();
      const externalTemp = writeFile(externalDir, relativeTemp, 'outside');
      let swapped = false;

      jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
        if (pid === stalePid && signal === 0) {
          if (!swapped) {
            fs.renameSync(sourceRoot, movedSourceRoot);
            fs.symlinkSync(externalDir, sourceRoot);
            swapped = true;
          }
          throw Object.assign(new Error('process is gone'), { code: 'ESRCH' });
        }
        return true;
      });

      apply([], { sourceRoots: [sourceRoot] });

      expect(swapped).toBe(true);
      expect(readFileSync(externalTemp, 'utf8')).toBe('outside');
      expect(readFileSync(join(movedSourceRoot, relativeTemp), 'utf8')).toBe(
        'inside',
      );
      expect(fs.existsSync(originalTemp)).toBe(true);
    },
  );

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

    const result = apply(auditStyles(styleFile));

    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('simulated EPERM');
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

      const result = apply(auditStyles(styleFile));

      expect(result.applied).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toContain('simulated EIO');
      expect(closeSpy).toHaveBeenCalled();
      expect(readFileSync(styleFile, 'utf8')).toBe(original);
      expect(
        fs
          .readdirSync(dirname(styleFile))
          .filter((name) => name.endsWith('.tmp')),
      ).toEqual([]);
    },
  );

  posixIt(
    'rewrites a read-only target when its directory permits replacement',
    () => {
      writeFile(projectDir, 'assets/a.svg', '<svg />');
      const styleFile = writeFile(
        projectDir,
        'src/components/card/card.scss',
        '.card { background: url("../assets/a.svg"); }',
      );
      fs.chmodSync(styleFile, 0o444);

      const result = apply(auditStyles(styleFile));

      expect(result.applied).toHaveLength(1);
      expect(result.skipped).toEqual([]);
      expect(readFileSync(styleFile, 'utf8')).toContain('url("/assets/a.svg")');
      expect(statSync(styleFile).mode & 0o7777).toBe(0o444);
    },
  );

  posixIt('breaks hardlinks rather than rewriting out-of-scope aliases', () => {
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    const original = '.card { background: url("../assets/a.svg"); }';
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      original,
    );
    const firstAlias = join(projectDir, 'card-first.scss');
    const secondAlias = join(projectDir, 'card-second.scss');
    fs.linkSync(styleFile, firstAlias);
    fs.linkSync(styleFile, secondAlias);

    expect(statSync(styleFile).nlink).toBe(3);

    const result = apply(auditStyles(styleFile));

    expect(result.applied).toHaveLength(1);
    expect(readFileSync(styleFile, 'utf8')).toContain('url("/assets/a.svg")');
    expect(statSync(styleFile).nlink).toBe(1);
    expect(readFileSync(firstAlias, 'utf8')).toBe(original);
    expect(readFileSync(secondAlias, 'utf8')).toBe(original);
    expect(statSync(firstAlias).nlink).toBe(2);
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

    const result = apply(findings);

    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain(
      'source changed while applying audit fixes',
    );
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

    const result = apply(findings);

    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain(
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

  it('continues after one file fails and reports all three outcomes', () => {
    writeConfiguredProject();
    writeFile(projectDir, 'assets/a.svg', '<svg />');
    writeFile(projectDir, 'assets/b.svg', '<svg />');
    writeFile(projectDir, 'assets/c.svg', '<svg />');
    const firstSource = '.a { background: url("assets/a.svg"); }';
    const secondSource = '.b { background: url("assets/b.svg"); }';
    const thirdSource = '.c { background: url("assets/c.svg"); }';
    const firstStyle = writeFile(
      projectDir,
      'src/components/a/a.scss',
      firstSource,
    );
    const secondStyle = writeFile(
      projectDir,
      'src/components/b/b.scss',
      secondSource,
    );
    const thirdStyle = writeFile(
      projectDir,
      'src/components/c/c.scss',
      thirdSource,
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

    const exitCode = runAuditCli([
      '--root',
      projectDir,
      '--fix',
      '--fail-on',
      'info',
    ]);
    const report = logSpy.mock.calls[0][0];

    expect(exitCode).toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(report).toContain(
      'Findings: 0 error(s), 0 warning(s), 1 info item(s).',
    );
    expect(report).toContain('[info] css-runtime-asset-reference');
    expect(report).toContain(
      'CSS asset URL "assets/b.svg" is not the canonical asset form',
    );
    expect(report).toContain('Applied 2 fix(es):');
    expect(report).toContain('src/components/a/a.scss');
    expect(report).toContain('src/components/b/b.scss');
    expect(report).toContain('src/components/c/c.scss');
    expect(report).toContain('Skipped 1 fixable finding(s):');
    expect(report).toContain('simulated EACCES');
    expect(readFileSync(firstStyle, 'utf8')).toContain('url("/assets/a.svg")');
    expect(readFileSync(secondStyle, 'utf8')).toContain('url("assets/b.svg")');
    expect(readFileSync(thirdStyle, 'utf8')).toContain('url("/assets/c.svg")');
    expect(
      fs
        .readdirSync(dirname(secondStyle))
        .filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
    expect(auditStyles(firstStyle)).toEqual([]);
    expect(auditStyles(thirdStyle)).toEqual([]);

    writeFileSync(firstStyle, firstSource);
    writeFileSync(secondStyle, secondSource);
    writeFileSync(thirdStyle, thirdSource);

    const jsonExitCode = runAuditCli([
      '--root',
      projectDir,
      '--fix',
      '--json',
      '--fail-on',
      'info',
    ]);
    const jsonReport = JSON.parse(logSpy.mock.calls[1][0]);

    expect(jsonExitCode).toBe(1);
    expect(jsonReport.findings).toEqual([
      expect.objectContaining({ path: 'src/components/b/b.scss' }),
    ]);
    expect(jsonReport.fixes.applied.map(({ path }) => path).sort()).toEqual([
      'src/components/a/a.scss',
      'src/components/c/c.scss',
    ]);
    expect(jsonReport.fixes.skipped).toEqual([
      expect.objectContaining({
        path: 'src/components/b/b.scss',
        reason: expect.stringContaining('simulated EACCES'),
      }),
    ]);
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
