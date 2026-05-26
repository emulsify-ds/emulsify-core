/**
 * @file Tests for Drupal component mirror plugin behavior.
 */

import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import { mirrorComponentsToRoot } from '../mirror-components.js';
import { makeTempProject } from '../../test-utils/plugins.js';

describe('component mirror plugin', () => {
  let projectDir;

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
    }
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
    expect(disabledMirror.closeBundle()).toBeUndefined();
    expect(existsSync(distComponentFile)).toBe(true);
    expect(existsSync(rootComponentFile)).toBe(false);

    enabledMirror.configResolved({ build: { outDir } });
    expect(enabledMirror.closeBundle()).toBeUndefined();
    expect(existsSync(distComponentFile)).toBe(false);
    expect(existsSync(rootComponentFile)).toBe(true);
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
    expect(mirror.closeBundle()).toBeUndefined();

    expect(existsSync(distComponentFile)).toBe(false);
    expect(statSync(rootComponentFile).mtimeMs).toBe(rootMtimeBefore);
  });
});
