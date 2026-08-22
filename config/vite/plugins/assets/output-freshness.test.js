/**
 * @file Tests for output freshness helpers.
 */

import fs, {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import { makeTempProject } from '../../test-utils/plugins.js';
import {
  bytesAlreadyOnDisk,
  filesHaveSameBytes,
  resolveFinalPath,
} from './output-freshness.js';

const LARGE_COMPARE_SIZE = 128 * 1024 + 7;

/**
 * Write a file, creating its parent directories.
 *
 * @param {string} filePath - Absolute file path.
 * @param {string} contents - File contents.
 */
const write = (filePath, contents) => {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents);
};

describe('resolveFinalPath', () => {
  const paths = { outDir: '/p/dist', projectDir: '/p', mirrored: false };

  it('places ordinary output under the output directory', () => {
    expect(resolveFinalPath('global/base/css/base.css', paths)).toBe(
      '/p/dist/global/base/css/base.css',
    );
  });

  it('follows mirrored component output out of dist', () => {
    // mirrorComponentsToRoot moves dist/components/** to <theme>/components/**,
    // so last cycle's copy is never in dist to compare against. Comparing
    // against dist would make every component file look new.
    expect(
      resolveFinalPath('components/card/css/card.css', {
        ...paths,
        mirrored: true,
      }),
    ).toBe('/p/components/card/css/card.css');
  });

  it('leaves non-component output in dist even when mirroring', () => {
    expect(
      resolveFinalPath('global/base/css/base.css', {
        ...paths,
        mirrored: true,
      }),
    ).toBe('/p/dist/global/base/css/base.css');
  });

  it('leaves component output in dist when not mirroring', () => {
    expect(resolveFinalPath('components/card/css/card.css', paths)).toBe(
      '/p/dist/components/card/css/card.css',
    );
  });
});

describe('filesHaveSameBytes', () => {
  let projectDir;

  afterEach(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('compares equal small files by bytes', () => {
    projectDir = makeTempProject();
    const sourceFile = join(projectDir, 'source.twig');
    const destinationFile = join(projectDir, 'destination.twig');
    writeFileSync(sourceFile, '<article>{{ title }}</article>');
    writeFileSync(destinationFile, '<article>{{ title }}</article>');

    expect(filesHaveSameBytes(sourceFile, destinationFile)).toBe(true);
  });

  it('compares equal large files by bytes', () => {
    projectDir = makeTempProject();
    const sourceFile = join(projectDir, 'source.twig');
    const destinationFile = join(projectDir, 'destination.twig');
    const largeContents = Buffer.alloc(LARGE_COMPARE_SIZE, 'a');
    writeFileSync(sourceFile, largeContents);
    writeFileSync(destinationFile, largeContents);

    expect(filesHaveSameBytes(sourceFile, destinationFile)).toBe(true);
  });

  it('detects large files that differ only in the last byte', () => {
    projectDir = makeTempProject();
    const sourceFile = join(projectDir, 'source.twig');
    const destinationFile = join(projectDir, 'destination.twig');
    const sourceContents = Buffer.alloc(LARGE_COMPARE_SIZE, 'a');
    const destinationContents = Buffer.from(sourceContents);
    destinationContents.write('b', destinationContents.length - 1);
    writeFileSync(sourceFile, sourceContents);
    writeFileSync(destinationFile, destinationContents);

    expect(filesHaveSameBytes(sourceFile, destinationFile)).toBe(false);
  });

  it('short-circuits different-size files without reading file bodies', () => {
    projectDir = makeTempProject();
    const sourceFile = join(projectDir, 'source.twig');
    const destinationFile = join(projectDir, 'destination.twig');
    writeFileSync(sourceFile, 'larger');
    writeFileSync(destinationFile, 'small');
    const readFileSpy = jest.spyOn(fs, 'readFileSync');
    const openSpy = jest.spyOn(fs, 'openSync');

    expect(filesHaveSameBytes(sourceFile, destinationFile)).toBe(false);
    expect(readFileSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('replaces a destination symlink without touching its target', () => {
    projectDir = makeTempProject();
    const sourceFile = join(projectDir, 'source.twig');
    const outsideFile = join(projectDir, 'shared.twig');
    const destinationFile = join(projectDir, 'dist/card.twig');
    write(sourceFile, '<article>new output</article>');
    write(outsideFile, '<article>shared source</article>');
    mkdirSync(join(destinationFile, '..'), { recursive: true });
    symlinkSync(outsideFile, destinationFile);

    if (!filesHaveSameBytes(sourceFile, destinationFile)) {
      copyFileSync(sourceFile, destinationFile);
    }

    expect(lstatSync(destinationFile).isSymbolicLink()).toBe(false);
    expect(readFileSync(destinationFile, 'utf8')).toBe(
      '<article>new output</article>',
    );
    expect(readFileSync(outsideFile, 'utf8')).toBe(
      '<article>shared source</article>',
    );
  });
});

describe('bytesAlreadyOnDisk', () => {
  const projectDir = makeTempProject();
  const file = join(projectDir, 'a.css');

  beforeAll(() => write(file, '.a{color:red}'));

  afterEach(() => jest.restoreAllMocks());

  it('is false for a file that does not exist', () => {
    expect(bytesAlreadyOnDisk(join(projectDir, 'nope.css'), '.a{}')).toBe(
      false,
    );
  });

  it('is true for identical bytes', () => {
    expect(bytesAlreadyOnDisk(file, '.a{color:red}')).toBe(true);
  });

  it('is false for different bytes', () => {
    expect(bytesAlreadyOnDisk(file, '.a{color:blue}')).toBe(false);
  });

  it('compares buffer sources as bytes', () => {
    expect(bytesAlreadyOnDisk(file, Buffer.from('.a{color:red}', 'utf8'))).toBe(
      true,
    );
  });

  it('detects a large asset changed only in its last byte without a full read', () => {
    const largeFile = join(projectDir, 'large.bin');
    const diskContents = Buffer.alloc(LARGE_COMPARE_SIZE, 'a');
    const emittedContents = Buffer.from(diskContents);
    emittedContents.write('b', emittedContents.length - 1);
    writeFileSync(largeFile, diskContents);
    const readFileSpy = jest.spyOn(fs, 'readFileSync');

    expect(bytesAlreadyOnDisk(largeFile, emittedContents)).toBe(false);
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it('removes an emitted asset destination symlink before comparison', () => {
    const outsideFile = join(projectDir, 'outside.css');
    const linkedFile = join(projectDir, 'linked.css');
    writeFileSync(outsideFile, '.outside{}');
    symlinkSync(outsideFile, linkedFile);

    expect(bytesAlreadyOnDisk(linkedFile, Buffer.from('.emitted{}'))).toBe(
      false,
    );
    writeFileSync(linkedFile, '.emitted{}');

    expect(lstatSync(linkedFile).isSymbolicLink()).toBe(false);
    expect(readFileSync(linkedFile, 'utf8')).toBe('.emitted{}');
    expect(readFileSync(outsideFile, 'utf8')).toBe('.outside{}');
  });
});
