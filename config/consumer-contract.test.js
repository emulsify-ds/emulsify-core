/**
 * @file Tests for generated-theme consumer dependency contracts.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const CONTRACT_DOC =
  'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/dependency-contract.md';

const readJson = (relativePath) =>
  JSON.parse(readFileSync(resolve(process.cwd(), relativePath), 'utf8'));

const hasOnlyScriptNames = (scripts) =>
  Array.isArray(scripts) &&
  scripts.length > 0 &&
  scripts.every((script) => typeof script === 'string' && script);

describe('consumer dependency contract', () => {
  const contract = readJson('config/consumer-contract.json');
  const packageJson = readJson('package.json');

  it('keeps every consumer-contract package in dependencies', () => {
    const contractDependencies = Object.keys(contract.dependencies || {});
    const packageDependencies = packageJson.dependencies || {};
    const missing = contractDependencies.filter(
      (dependency) => !packageDependencies[dependency],
    );

    if (missing.length) {
      throw new Error(
        [
          `Missing consumer-contract dependencies in package.json#dependencies: ${missing.join(', ')}.`,
          'Generated themes such as Whisk declare only @emulsify/core and rely on npm hoisting to resolve the binaries and config packages their scripts invoke.',
          'Keep these packages in dependencies unless verified consumer evidence changes the contract.',
          `Docs: ${CONTRACT_DOC}`,
        ].join('\n'),
      );
    }
  });

  it('records one-line notes for every kept contract package', () => {
    const notes = contract.notes || {};
    const missingNotes = Object.keys(contract.dependencies || {}).filter(
      (dependency) =>
        typeof notes[dependency] !== 'string' ||
        !notes[dependency].trim() ||
        notes[dependency].includes('\n'),
    );

    expect(missingNotes).toEqual([]);
  });

  it('maps every contract package to at least one Whisk script', () => {
    const invalidScripts = Object.entries(contract.dependencies || {})
      .filter(([, scripts]) => !hasOnlyScriptNames(scripts))
      .map(([dependency]) => dependency);

    expect(invalidScripts).toEqual([]);
  });
});
