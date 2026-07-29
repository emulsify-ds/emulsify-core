/**
 * @file Tests for shared filesystem helpers.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directorySize } from './fs.js';

describe('script filesystem helpers', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'emulsify-script-fs-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('recursively totals file sizes', () => {
    mkdirSync(join(tempDir, 'nested'));
    writeFileSync(join(tempDir, 'one.txt'), 'one');
    writeFileSync(join(tempDir, 'nested', 'two.txt'), 'two-two');

    expect(directorySize(tempDir)).toBe(10);
  });

  it('returns zero when a directory cannot be read', () => {
    expect(directorySize(join(tempDir, 'missing'))).toBe(0);
  });
});
