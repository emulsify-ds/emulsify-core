/**
 * @file Tests for shared project asset root resolution.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { resolveAssetTail } from './asset-roots.js';

const makeTempDir = () =>
  mkdtempSync(join(tmpdir(), 'emulsify-core-asset-roots-'));

describe('asset root resolution', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not resolve a directory as an asset', () => {
    const root = join(tempDir, 'assets');
    mkdirSync(join(root, 'images'), { recursive: true });

    expect(resolveAssetTail('images/', [root])).toEqual({
      status: 'missing',
      candidates: [],
    });
  });

  it('ignores a directory when another root contains a matching file', () => {
    const firstRoot = join(tempDir, 'first');
    const secondRoot = join(tempDir, 'second');
    const file = join(secondRoot, 'images', 'logo.png');
    mkdirSync(join(firstRoot, 'images', 'logo.png'), { recursive: true });
    mkdirSync(join(secondRoot, 'images'), { recursive: true });
    writeFileSync(file, 'logo');

    expect(
      resolveAssetTail('images/logo.png', [firstRoot, secondRoot]),
    ).toEqual({
      status: 'resolved',
      file,
      root: secondRoot,
      candidates: [file],
    });
  });
});
