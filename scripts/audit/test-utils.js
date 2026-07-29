/**
 * @file Test utilities for audit modules.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function makeTempProject() {
  return mkdtempSync(join(tmpdir(), 'emulsify-audit-'));
}

export function removeTempProject(projectDir) {
  rmSync(projectDir, { recursive: true, force: true });
}

export function writeFile(projectDir, relPath, contents = '') {
  const filePath = join(projectDir, relPath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
  return filePath;
}
