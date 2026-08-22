/**
 * @file Containment regressions for audit autofixes.
 */

import fs, { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { runCli as runAuditCli } from '../audit.js';
import { applyAuditFixes } from './fix.js';
import { resetFileReadCache } from './lib/files.js';
import { makeTempProject, removeTempProject, writeFile } from './test-utils.js';

const originalSource = '.card { background: url("assets/a.svg"); }';
const originalSpecifier = 'assets/a.svg';
const replacementSpecifier = '/assets/a.svg';
const ignoredTargetCases = [
  ['node_modules', 'node_modules/some-package/style.scss'],
  ['dist', 'dist/style.scss'],
  ...(['darwin', 'win32'].includes(process.platform)
    ? [
        ['case-varied node_modules', 'Node_Modules/some-package/style.scss'],
        ['case-varied dist', 'Dist/style.scss'],
      ]
    : []),
];

describe('audit fix containment', () => {
  let sandboxDir;

  beforeEach(() => {
    sandboxDir = makeTempProject();
    resetFileReadCache();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    removeTempProject(sandboxDir);
    jest.restoreAllMocks();
  });

  const writeConfiguredProject = (projectDir) => {
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
    writeFile(projectDir, 'assets/a.svg', '<svg />');

    return writeFile(
      projectDir,
      'src/components/card/card.scss',
      originalSource,
    );
  };

  const findingFor = (filePath) => {
    const start = originalSource.indexOf(originalSpecifier);

    return {
      id: 'css-runtime-asset-reference',
      severity: 'info',
      filePath,
      line: 1,
      fix: {
        filePath,
        start,
        end: start + originalSpecifier.length,
        original: originalSpecifier,
        replacement: replacementSpecifier,
      },
    };
  };

  const replaceWithSymlink = (linkPath, targetPath) => {
    fs.unlinkSync(linkPath);
    fs.symlinkSync(targetPath, linkPath);
  };

  const expectCliFix = (projectDir, rootArgument) => {
    const styleFile = writeConfiguredProject(projectDir);

    expect(runAuditCli(['--root', rootArgument, '--fix'])).toBe(0);
    expect(readFileSync(styleFile, 'utf8')).toContain(
      `url("${replacementSpecifier}")`,
    );
  };

  it.each(ignoredTargetCases)(
    'refuses a source symlink into %s',
    (_label, targetPath) => {
      const projectDir = join(sandboxDir, 'project');
      const targetFile = writeFile(projectDir, targetPath, originalSource);
      const styleFile = writeConfiguredProject(projectDir);
      replaceWithSymlink(styleFile, targetFile);
      const finding = findingFor(styleFile);

      // The real CLI must neither advertise nor apply a rewrite discovered
      // through an included symlink into an ignored tree.
      expect(runAuditCli(['--root', projectDir, '--fix'])).toBe(0);
      expect(console.log).toHaveBeenLastCalledWith(
        expect.not.stringContaining('Run `emulsify-audit --fix`'),
      );
      expect(readFileSync(targetFile, 'utf8')).toBe(originalSource);

      // A project-wide source root deliberately makes DEFAULT_IGNORES, rather
      // than source-root containment alone, responsible for this rejection.
      const result = applyAuditFixes([finding], {
        projectDir,
        sourceRoots: [projectDir],
      });

      expect(result.applied).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toEqual({
        finding,
        reason: expect.any(String),
      });
      expect(readFileSync(targetFile, 'utf8')).toBe(originalSource);
      expect(fs.lstatSync(styleFile).isSymbolicLink()).toBe(true);
    },
  );

  it('refuses a real target outside the configured source roots', () => {
    const projectDir = join(sandboxDir, 'project');
    const targetFile = writeFile(
      projectDir,
      'shared/card.scss',
      originalSource,
    );
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '',
    );
    replaceWithSymlink(styleFile, targetFile);
    const finding = findingFor(styleFile);

    const result = applyAuditFixes([finding], {
      projectDir,
      sourceRoots: [join(projectDir, 'src')],
    });

    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].finding).toBe(finding);
    expect(readFileSync(targetFile, 'utf8')).toBe(originalSource);
    expect(fs.lstatSync(styleFile).isSymbolicLink()).toBe(true);
  });

  it('derives source roots when direct API callers omit them', () => {
    const projectDir = join(sandboxDir, 'project');
    const targetFile = writeFile(
      projectDir,
      'shared/card.scss',
      originalSource,
    );
    const styleFile = writeConfiguredProject(projectDir);
    replaceWithSymlink(styleFile, targetFile);
    const finding = findingFor(styleFile);

    const result = applyAuditFixes([finding], { projectDir });

    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].finding).toBe(finding);
    expect(readFileSync(targetFile, 'utf8')).toBe(originalSource);
  });

  it('rewrites a symlink whose real target remains inside source roots', () => {
    const projectDir = join(sandboxDir, 'project');
    const targetFile = writeFile(
      projectDir,
      'src/shared/card.scss',
      originalSource,
    );
    const styleFile = writeFile(
      projectDir,
      'src/components/card/card.scss',
      '',
    );
    replaceWithSymlink(styleFile, targetFile);

    const result = applyAuditFixes([findingFor(styleFile)], {
      projectDir,
      sourceRoots: [join(projectDir, 'src')],
    });

    expect(result.applied).toHaveLength(1);
    expect(readFileSync(targetFile, 'utf8')).toContain(
      `url("${replacementSpecifier}")`,
    );
    expect(fs.lstatSync(styleFile).isSymbolicLink()).toBe(true);
  });

  it('accepts a symlinked project root whose real path contains node_modules', () => {
    const projectDir = join(
      sandboxDir,
      'node_modules',
      '.pnpm',
      'theme-package',
    );
    const rootAlias = join(sandboxDir, 'theme-alias');
    const styleFile = writeConfiguredProject(projectDir);
    fs.symlinkSync(projectDir, rootAlias, 'junction');

    expect(runAuditCli(['--root', rootAlias, '--fix'])).toBe(0);
    expect(readFileSync(styleFile, 'utf8')).toContain(
      `url("${replacementSpecifier}")`,
    );
  });

  it.each([
    ['a relative root', (projectDir) => relative(process.cwd(), projectDir)],
    ['a trailing separator', (projectDir) => `${projectDir}${sep}`],
    ['dot-dot segments', (projectDir) => `${projectDir}${sep}src${sep}..`],
  ])('accepts --root with %s', (_label, rootArgument) => {
    const projectDir = join(sandboxDir, 'project');

    expectCliFix(projectDir, rootArgument(projectDir));
  });

  it('accepts a project nested in a normal monorepo', () => {
    const projectDir = join(sandboxDir, 'packages', 'theme');

    expectCliFix(projectDir, projectDir);
  });
});
