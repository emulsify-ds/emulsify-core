/**
 * @file Tests for generated-theme consumer dependency contracts.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  assertContractDependencies,
  assertFixtureCoverage,
  assertProvidedBinaries,
  contractScriptNames,
} from '../scripts/lib/consumer-contract.js';

const readJson = (relativePath) =>
  JSON.parse(readFileSync(resolve(process.cwd(), relativePath), 'utf8'));

const hasOnlyScriptNames = (scripts) =>
  Array.isArray(scripts) &&
  scripts.length > 0 &&
  scripts.every((script) => typeof script === 'string' && script);

describe('consumer dependency contract', () => {
  const contract = readJson('config/consumer-contract.json');
  const packageJson = readJson('package.json');
  const fixturePackages = new Map(
    Object.entries(contract.fixtures || {}).map(([fixtureName, fixture]) => [
      fixtureName,
      readJson(`${fixture.directory}/package.json`),
    ]),
  );

  it('keeps every consumer-contract package in dependencies', () => {
    expect(() =>
      assertContractDependencies(contract, packageJson, fixturePackages),
    ).not.toThrow();
  });

  it('keeps provided binaries separate from Whisk script mappings', () => {
    expect(contract.providedBinaries).toEqual({
      emulsify: {
        package: '@emulsify/cli',
        description:
          'Core 4.x compatibility bridge for the project-local Emulsify CLI binary.',
      },
    });
    expect(contract.dependencies['@emulsify/cli']).toBeUndefined();
    expect(() => assertProvidedBinaries(contract, packageJson)).not.toThrow();

    const packageWithoutCli = {
      ...packageJson,
      dependencies: { ...packageJson.dependencies },
    };
    delete packageWithoutCli.dependencies['@emulsify/cli'];

    expect(() => assertProvidedBinaries(contract, packageWithoutCli)).toThrow(
      'emulsify requires package.json#dependencies["@emulsify/cli"]',
    );
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

  it('represents every contract script in a behavioral fixture', () => {
    expect(() =>
      assertFixtureCoverage(contract, fixturePackages),
    ).not.toThrow();
    expect(contractScriptNames(contract)).toEqual([
      'develop',
      'build',
      'vite',
      'storybook',
      'storybook-build',
      'lint-js',
      'lint-styles',
      'test',
      'coverage',
      'twatch',
      'a11y',
    ]);
  });

  it('reports the affected scripts and fixtures for a removed dependency', () => {
    const packageWithoutVite = {
      ...packageJson,
      dependencies: { ...packageJson.dependencies },
    };
    delete packageWithoutVite.dependencies.vite;

    expect(() =>
      assertContractDependencies(contract, packageWithoutVite, fixturePackages),
    ).toThrow(
      [
        'Missing consumer-contract dependencies in package.json#dependencies:',
        '- vite (scripts: build, vite, develop; fixtures: whisk-drupal, none, wordpress-twig)',
      ].join('\n'),
    );
  });

  it('fails when a mapped script disappears from all fixture packages', () => {
    const packagesWithoutDevelop = new Map(fixturePackages);
    const whiskPackage = packagesWithoutDevelop.get('whisk-drupal');
    packagesWithoutDevelop.set('whisk-drupal', {
      ...whiskPackage,
      scripts: Object.fromEntries(
        Object.entries(whiskPackage.scripts).filter(
          ([scriptName]) => scriptName !== 'develop',
        ),
      ),
    });

    expect(() =>
      assertFixtureCoverage(contract, packagesWithoutDevelop),
    ).toThrow(
      'Consumer contract scripts are not represented by a fixture package: develop.',
    );
  });

  it('pins both supported React peer majors for the mixed fixture', () => {
    expect(contract.reactMatrix).toEqual({
      fixture: 'mixed-storybook',
      versions: {
        18: '18.3.1',
        19: '19.2.7',
      },
    });
    expect(packageJson.peerDependencies.react).toContain('^18.0.0');
    expect(packageJson.peerDependencies.react).toContain('^19.0.0');
    expect(packageJson.peerDependencies['react-dom']).toContain('^18.0.0');
    expect(packageJson.peerDependencies['react-dom']).toContain('^19.0.0');
  });
});
