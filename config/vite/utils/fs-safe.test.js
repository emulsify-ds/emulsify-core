/**
 * @file Tests for safe filesystem utilities.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  firstExistingPath,
  safeExists,
  safeReadFile,
  safeReadJson,
} from './fs-safe.js';

const makeTempDir = () => mkdtempSync(join(tmpdir(), 'emulsify-core-fs-'));

describe('safe filesystem utilities', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads existing files and returns an empty string for missing files', () => {
    const filePath = join(tempDir, 'example.txt');
    writeFileSync(filePath, 'content');

    expect(safeReadFile(filePath)).toBe('content');
    expect(safeReadFile(join(tempDir, 'missing.txt'))).toBe('');
  });

  it('reads valid JSON and preserves parse errors for callers', () => {
    const validPath = join(tempDir, 'valid.json');
    const invalidPath = join(tempDir, 'invalid.json');
    writeFileSync(validPath, JSON.stringify({ name: 'Emulsify' }));
    writeFileSync(invalidPath, '{');

    expect(safeReadJson(validPath)).toEqual({
      data: { name: 'Emulsify' },
    });
    expect(safeReadJson(join(tempDir, 'missing.json'))).toEqual({});
    expect(safeReadJson(invalidPath).error).toBeInstanceOf(Error);
  });

  it('checks existence without throwing', () => {
    const filePath = join(tempDir, 'exists.txt');
    writeFileSync(filePath, 'content');

    expect(safeExists(filePath)).toBe(true);
    expect(safeExists(join(tempDir, 'missing.txt'))).toBe(false);
  });

  it('returns the first existing candidate path', () => {
    const first = join(tempDir, 'first.txt');
    const second = join(tempDir, 'second.txt');
    writeFileSync(second, 'content');

    expect(firstExistingPath([null, first, second])).toBe(second);
    expect(firstExistingPath([first])).toBeUndefined();
  });
});
