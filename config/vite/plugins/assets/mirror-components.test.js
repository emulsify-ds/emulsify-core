/**
 * @file Tests for Drupal component mirror plugin behavior.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import { mirrorComponentsToRoot } from './mirror-components.js';
import { makeTempProject } from '../../test-utils/plugins.js';

const MIRROR_STATE_FILE = '.emulsify-mirror-state.json';

const readMirrorState = (outDir) =>
  JSON.parse(readFileSync(join(outDir, MIRROR_STATE_FILE), 'utf8'));

describe('component mirror plugin', () => {
  let projectDir;

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
    }
    jest.restoreAllMocks();
  });

  it('mirrors built components when enabled and skips mirroring when disabled', () => {
    projectDir = makeTempProject();
    const outDir = join(projectDir, 'dist');
    const distComponentFile = join(outDir, 'components/card/card.twig');
    const rootComponentFile = join(projectDir, 'components/card/card.twig');
    const disabledMirror = mirrorComponentsToRoot({
      enabled: false,
      projectDir,
    });
    const enabledMirror = mirrorComponentsToRoot({
      enabled: true,
      projectDir,
    });

    mkdirSync(join(outDir, 'components/card'), { recursive: true });
    writeFileSync(distComponentFile, '<article>{{ title }}</article>');
    disabledMirror.configResolved({ build: { outDir } });
    expect(disabledMirror.writeBundle()).toBeUndefined();
    expect(existsSync(distComponentFile)).toBe(true);
    expect(existsSync(rootComponentFile)).toBe(false);

    enabledMirror.configResolved({ build: { outDir } });
    expect(enabledMirror.writeBundle()).toBeUndefined();
    expect(existsSync(distComponentFile)).toBe(false);
    expect(existsSync(rootComponentFile)).toBe(true);
    expect(readMirrorState(outDir).completedAt).toEqual(expect.any(String));
  });

  it('does not rewrite identical mirrored component files', () => {
    projectDir = makeTempProject();
    const outDir = join(projectDir, 'dist');
    const distComponentFile = join(outDir, 'components/card/card.twig');
    const rootComponentFile = join(projectDir, 'components/card/card.twig');
    const mirror = mirrorComponentsToRoot({ enabled: true, projectDir });

    mkdirSync(join(outDir, 'components/card'), { recursive: true });
    mkdirSync(join(projectDir, 'components/card'), { recursive: true });
    writeFileSync(distComponentFile, '<article>{{ title }}</article>');
    writeFileSync(rootComponentFile, '<article>{{ title }}</article>');
    utimesSync(
      rootComponentFile,
      new Date('2000-01-01T00:00:00Z'),
      new Date('2000-01-01T00:00:00Z'),
    );
    const rootMtimeBefore = statSync(rootComponentFile).mtimeMs;

    mirror.configResolved({ build: { outDir } });
    expect(mirror.writeBundle()).toBeUndefined();

    expect(existsSync(distComponentFile)).toBe(false);
    expect(statSync(rootComponentFile).mtimeMs).toBe(rootMtimeBefore);
  });

  it('replaces an identical destination symlink without touching its target', () => {
    projectDir = makeTempProject();
    const outDir = join(projectDir, 'dist');
    const distComponentFile = join(outDir, 'components/card/card.twig');
    const rootComponentFile = join(projectDir, 'components/card/card.twig');
    const sharedFile = join(projectDir, 'shared/card.twig');
    const contents = '<article>{{ title }}</article>';
    const mirror = mirrorComponentsToRoot({ enabled: true, projectDir });

    mkdirSync(join(distComponentFile, '..'), { recursive: true });
    mkdirSync(join(rootComponentFile, '..'), { recursive: true });
    mkdirSync(join(sharedFile, '..'), { recursive: true });
    writeFileSync(distComponentFile, contents);
    writeFileSync(sharedFile, contents);
    utimesSync(
      sharedFile,
      new Date('2000-01-01T00:00:00Z'),
      new Date('2000-01-01T00:00:00Z'),
    );
    const sharedMtimeBefore = statSync(sharedFile).mtimeMs;
    symlinkSync(sharedFile, rootComponentFile);

    mirror.configResolved({ build: { outDir } });
    expect(mirror.writeBundle()).toBeUndefined();

    expect(existsSync(distComponentFile)).toBe(false);
    expect(lstatSync(rootComponentFile).isSymbolicLink()).toBe(false);
    expect(readFileSync(rootComponentFile, 'utf8')).toBe(contents);
    expect(readFileSync(sharedFile, 'utf8')).toBe(contents);
    expect(statSync(sharedFile).mtimeMs).toBe(sharedMtimeBefore);
  });

  it('keeps interleaved build observations free of partial dist component files', () => {
    projectDir = makeTempProject();
    const outDir = join(projectDir, 'dist');
    const fixtureFiles = [
      'card.js',
      'card.css',
      'card.twig',
      'card.component.yml',
      'card.asset.txt',
    ];
    const firstMirror = mirrorComponentsToRoot({ enabled: true, projectDir });
    const secondMirror = mirrorComponentsToRoot({ enabled: true, projectDir });
    const writeDistFixture = (label) => {
      mkdirSync(join(outDir, 'components/card'), { recursive: true });
      for (const fileName of fixtureFiles) {
        writeFileSync(
          join(outDir, 'components/card', fileName),
          `${fileName}: ${label}`,
        );
      }
    };
    const expectMirroredFixture = (label) => {
      for (const fileName of fixtureFiles) {
        expect(existsSync(join(outDir, 'components/card', fileName))).toBe(
          false,
        );
        expect(
          readFileSync(join(projectDir, 'components/card', fileName), 'utf8'),
        ).toBe(`${fileName}: ${label}`);
      }
    };

    firstMirror.configResolved({ build: { outDir } });
    secondMirror.configResolved({ build: { outDir } });

    writeDistFixture('first build');
    expect(firstMirror.writeBundle()).toBeUndefined();
    expectMirroredFixture('first build');

    writeDistFixture('second build');
    expect(secondMirror.writeBundle()).toBeUndefined();
    expectMirroredFixture('second build');
    expect(readMirrorState(outDir).completedAt).toEqual(expect.any(String));
  });

  it('keeps watch maps but removes stale mirrored maps for production', () => {
    projectDir = makeTempProject();
    const outDir = join(projectDir, 'dist');
    const rootComponentDir = join(projectDir, 'components/card');
    const sourceMap = join(rootComponentDir, 'card.js.map');
    const upperCaseSourceMap = join(rootComponentDir, 'card.css.MAP');
    const componentFile = join(rootComponentDir, 'card.js');
    const mapAsset = join(rootComponentDir, 'regions.map');
    const watchMirror = mirrorComponentsToRoot({ enabled: true, projectDir });
    const productionMirror = mirrorComponentsToRoot({
      enabled: true,
      projectDir,
    });

    mkdirSync(rootComponentDir, { recursive: true });
    writeFileSync(sourceMap, '{}');
    writeFileSync(upperCaseSourceMap, '{}');
    writeFileSync(componentFile, 'export default {};');
    writeFileSync(mapAsset, 'legitimate map asset');

    watchMirror.configResolved({ build: { outDir, watch: {} } });
    expect(watchMirror.writeBundle()).toBeUndefined();
    expect(existsSync(sourceMap)).toBe(true);
    expect(existsSync(upperCaseSourceMap)).toBe(true);

    productionMirror.configResolved({ build: { outDir } });
    expect(productionMirror.writeBundle()).toBeUndefined();
    expect(existsSync(sourceMap)).toBe(false);
    expect(existsSync(upperCaseSourceMap)).toBe(false);
    expect(readFileSync(componentFile, 'utf8')).toBe('export default {};');
    expect(readFileSync(mapAsset, 'utf8')).toBe('legitimate map asset');
  });

  it('warns when a previous mirror build marker was interrupted', () => {
    projectDir = makeTempProject();
    const outDir = join(projectDir, 'dist');
    const markerFile = join(outDir, MIRROR_STATE_FILE);
    const mirror = mirrorComponentsToRoot({ enabled: true, projectDir });
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      markerFile,
      JSON.stringify({
        startedAt: '2026-05-26T00:00:00.000Z',
        completedAt: null,
        version: '0.0.0-test',
      }),
    );

    mirror.configResolved({ build: { outDir } });
    expect(mirror.writeBundle()).toBeUndefined();

    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Previous Emulsify component mirror build was interrupted',
      ),
    );
    expect(readMirrorState(outDir).completedAt).toEqual(expect.any(String));
    consoleWarn.mockRestore();
  });
});
