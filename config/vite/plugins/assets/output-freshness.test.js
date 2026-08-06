/**
 * @file Tests for output freshness helpers.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { makeTempProject } from '../../test-utils/plugins.js';
import { bytesAlreadyOnDisk, resolveFinalPath } from './output-freshness.js';

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

describe('bytesAlreadyOnDisk', () => {
  const projectDir = makeTempProject();
  const file = join(projectDir, 'a.css');

  beforeAll(() => write(file, '.a{color:red}'));

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
});
