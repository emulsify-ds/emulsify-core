/**
 * @file Architectural guard for one-directional config/src layering.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC_DIR = join(process.cwd(), 'src');
const SRC_TO_CONFIG_IMPORT =
  /(?:from\s+|import\s*\(\s*)['"](?:\.\.\/)+config\//;

const collectJavaScriptFiles = (directory) =>
  readdirSync(directory).flatMap((entry) => {
    const filePath = join(directory, entry);
    const stats = statSync(filePath);

    if (stats.isDirectory()) {
      return collectJavaScriptFiles(filePath);
    }

    return /\.[cm]?jsx?$/.test(entry) ? [filePath] : [];
  });

describe('source layering', () => {
  it('does not import build-tool config modules from src', () => {
    const offenders = collectJavaScriptFiles(SRC_DIR)
      .filter((filePath) =>
        SRC_TO_CONFIG_IMPORT.test(readFileSync(filePath, 'utf8')),
      )
      .map((filePath) => relative(process.cwd(), filePath));

    expect(offenders).toEqual([]);
  });
});
