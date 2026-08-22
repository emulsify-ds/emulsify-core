/**
 * @file Copy failure reporting tests.
 */

import {
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveProjectStructure } from '../../project-structure.js';
import { makeEnv, makeTempProject } from '../../test-utils/plugins.js';
import { createDiagnosticsCollector } from '../reporter/diagnostics.js';
import { createStyler } from '../reporter/format.js';
import { hasCycleFailure, renderRebuild } from '../reporter/render.js';
import { copyAllSrcAssetsPlugin } from './copy-src-assets.js';
import { copyTwigFilesPlugin } from './copy-twig-files.js';

describe('source copy failure reporting', () => {
  let projectDir;
  let outsideDir;

  afterEach(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    if (outsideDir) rmSync(outsideDir, { recursive: true, force: true });
  });

  it.each([
    ['Twig template', copyTwigFilesPlugin, 'card.twig'],
    ['static asset', copyAllSrcAssetsPlugin, 'icon.svg'],
  ])(
    'warns and fails the cycle when copying a %s fails',
    (_label, factory, fileName) => {
      projectDir = makeTempProject();
      const sourceDir = join(projectDir, 'src/components/card');
      const sourcePath = join(sourceDir, fileName);
      const outDir = join(projectDir, 'dist');
      const destinationPath = join(outDir, 'components/card', fileName);
      const original = `original ${fileName}`;
      const diagnostics = createDiagnosticsCollector();
      const outputChanges = new Map();
      const warn = jest.fn();

      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(sourcePath, original);

      const plugin = factory({
        structure: resolveProjectStructure(makeEnv(projectDir)),
        diagnostics,
        outputChanges,
      });
      plugin.configResolved({
        root: projectDir,
        build: { outDir, watch: {} },
      });
      plugin.writeBundle.call({ warn });

      // Keep the cached plan but remove its source. The copy now fails with a
      // deterministic ENOENT while the previous cycle's output stays on disk,
      // which is precisely the stale success the diagnostic must expose.
      outputChanges.clear();
      rmSync(sourcePath);
      plugin.writeBundle.call({ warn });

      const snapshot = diagnostics.snapshot();
      const [warning] = warn.mock.calls.at(-1);
      expect(readFileSync(destinationPath, 'utf8')).toBe(original);
      expect(warning).toContain(sourcePath);
      expect(warning).toContain(destinationPath);
      expect(warning).toContain('(ENOENT)');
      expect(snapshot.errors).toEqual([
        expect.objectContaining({
          file: sourcePath,
          message: expect.stringContaining(destinationPath),
          outputState: 'incomplete',
        }),
      ]);
      expect(hasCycleFailure(snapshot)).toBe(true);
      expect(outputChanges.size).toBe(0);
      const rebuildOutput = renderRebuild({
        snapshot,
        durationMs: 10,
        changedFiles: [sourcePath],
        projectDir,
        styler: createStyler(false),
      }).join('\n');
      expect(rebuildOutput).toContain('rebuild failed');
      expect(rebuildOutput).toContain('output may be incomplete');
    },
  );

  it.each([
    ['Twig template', copyTwigFilesPlugin, 'card.twig'],
    ['static asset', copyAllSrcAssetsPlugin, 'icon.svg'],
  ])(
    'reports a destination directory failure and continues copying later %s files',
    (_label, factory, fileName) => {
      projectDir = makeTempProject();
      const componentRoot = join(projectDir, 'src/components');
      const blockedSource = join(componentRoot, 'z-blocked', fileName);
      const goodSource = join(componentRoot, 'a-good', fileName);
      const outDir = join(projectDir, 'dist');
      const blockedDestinationDir = join(outDir, 'components/z-blocked');
      const blockedDestination = join(blockedDestinationDir, fileName);
      const goodDestination = join(outDir, 'components/a-good', fileName);
      const diagnostics = createDiagnosticsCollector();
      const outputChanges = new Map();
      const warn = jest.fn();

      mkdirSync(dirname(blockedSource), { recursive: true });
      mkdirSync(dirname(goodSource), { recursive: true });
      mkdirSync(dirname(blockedDestinationDir), { recursive: true });
      writeFileSync(blockedSource, `blocked ${fileName}`);
      writeFileSync(goodSource, `good ${fileName}`);

      // A regular file where the destination directory must be makes recursive
      // mkdir fail consistently across platforms, without relying on chmod
      // behavior that differs for privileged test processes.
      writeFileSync(blockedDestinationDir, 'not a directory');

      const structure = resolveProjectStructure(makeEnv(projectDir));
      const sourceFileIndex = {
        componentFiles: () => [
          { absPath: blockedSource },
          { absPath: goodSource },
        ],
        globalFiles: () => [],
      };
      const plugin = factory({
        structure,
        sourceFileIndex,
        diagnostics,
        outputChanges,
      });
      plugin.configResolved({
        root: projectDir,
        build: { outDir, watch: {} },
      });

      expect(() => plugin.writeBundle.call({ warn })).not.toThrow();

      expect(readFileSync(blockedDestinationDir, 'utf8')).toBe(
        'not a directory',
      );
      expect(readFileSync(goodDestination, 'utf8')).toBe(`good ${fileName}`);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(blockedDestination),
      );
      expect(diagnostics.snapshot().errors).toEqual([
        expect.objectContaining({
          file: blockedSource,
          message: expect.stringContaining(blockedDestination),
          outputState: 'incomplete',
        }),
      ]);
      expect(outputChanges).toEqual(
        new Map([
          [
            `components/a-good/${fileName}`,
            {
              kind: 'written',
              bytes: Buffer.byteLength(`good ${fileName}`),
            },
          ],
        ]),
      );
    },
  );

  it.each([
    ['Twig template', copyTwigFilesPlugin, 'card.twig'],
    ['static asset', copyAllSrcAssetsPlugin, 'icon.svg'],
  ])(
    'replaces a one-shot %s destination symlink without touching its target',
    (_label, factory, fileName) => {
      projectDir = makeTempProject();
      outsideDir = makeTempProject();
      const sourcePath = join(projectDir, 'src/components/card', fileName);
      const outDir = join(projectDir, 'dist');
      const destinationPath = join(outDir, 'components/card', fileName);
      const outsideTarget = join(outsideDir, fileName);
      const sourceBytes = `source ${fileName}`;
      const outsideBytes = `outside ${fileName}`;

      mkdirSync(dirname(sourcePath), { recursive: true });
      mkdirSync(dirname(destinationPath), { recursive: true });
      writeFileSync(sourcePath, sourceBytes);
      writeFileSync(outsideTarget, outsideBytes);
      symlinkSync(outsideTarget, destinationPath);

      const plugin = factory({
        structure: resolveProjectStructure(makeEnv(projectDir)),
      });
      plugin.configResolved({ root: projectDir, build: { outDir } });
      plugin.writeBundle.call({ warn: jest.fn() });

      expect(lstatSync(destinationPath).isSymbolicLink()).toBe(false);
      expect(readFileSync(destinationPath, 'utf8')).toBe(sourceBytes);
      expect(readFileSync(outsideTarget, 'utf8')).toBe(outsideBytes);
    },
  );
});
