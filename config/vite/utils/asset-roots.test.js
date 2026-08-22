/**
 * @file Tests for shared project asset root resolution.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';

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

  it.each([
    ['an absolute POSIX tail', '/logo.png'],
    ['a drive-qualified tail', 'D:/outside/secret.svg'],
    ['a backslash drive tail', 'D:\\outside\\secret.svg'],
    ['a drive-relative tail', 'D:outside/secret.svg'],
    ['a drive-like POSIX filename', 'x:y.png'],
    ['a UNC tail', '\\\\server\\share\\secret.svg'],
    ['a forward-slash UNC tail', '//server/share/secret.svg'],
  ])('refuses %s', (_label, tail) => {
    // A tail is everything after the `assets/` prefix, so it is relative by
    // construction. On Windows `resolve()` switches away from the asset root
    // for any of these, and a cross-volume `relative()` result begins with
    // neither `..` nor `../`, so a prefix-only containment check reads the
    // escape as containment. Windows semantics are rejected on every platform
    // so this stays covered in CI.
    // Put a file at the path the old POSIX implementation derived after
    // stripping leading slashes. This makes the assertion prove the syntax is
    // rejected instead of passing merely because its candidate is absent.
    if (process.platform !== 'win32') {
      const decoy = resolve(tempDir, tail.replace(/^\/+/, ''));
      mkdirSync(dirname(decoy), { recursive: true });
      writeFileSync(decoy, 'not an asset');
    }

    expect(resolveAssetTail(tail, [tempDir])).toEqual({
      status: 'missing',
      candidates: [],
    });
  });

  it('still resolves a tail whose directory merely looks drive-like', () => {
    const file = join(tempDir, 'C', 'logo.png');
    mkdirSync(join(tempDir, 'C'), { recursive: true });
    writeFileSync(file, 'logo');

    expect(resolveAssetTail('C/logo.png', [tempDir])).toEqual({
      status: 'resolved',
      file,
      root: tempDir,
      candidates: [file],
    });
  });
});
