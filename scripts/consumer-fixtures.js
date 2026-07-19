#!/usr/bin/env node
/**
 * @file Install the packed package in representative generated consumers.
 */

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUsage, parseArgs as parseCliArgs } from './lib/cli.js';
import { run } from './lib/proc.js';
import {
  assertContractDependencies,
  assertFixtureCoverage,
  assertProvidedBinaries,
} from './lib/consumer-contract.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = join(repoRoot, 'config/consumer-contract.json');
const packagePath = join(repoRoot, 'package.json');

const readJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf8'));

const contract = readJson(contractPath);
const packageJson = readJson(packagePath);

function usage() {
  return createUsage(
    'Usage: node scripts/consumer-fixtures.js [--fixture <name>] [--react <major>] [--list]',
    [
      '  --fixture <name>  Run one fixture. Can be repeated or comma-separated.',
      '  --react <major>    Run the React peer fixture with a configured major.',
      '  --list             Print fixture names and exit.',
      '  --help             Print this help text.',
    ],
  );
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  return parseCliArgs(argv, {
    defaults: {
      fixtureNames: [],
      help: false,
      list: false,
      reactMajors: [],
    },
    flags: {
      '--list': 'list',
    },
    options: {
      '--fixture': {
        key: 'fixtureNames',
        append: true,
        parse: parseList,
        missingMessage: '--fixture requires a fixture name.',
      },
      '--react': {
        key: 'reactMajors',
        append: true,
        parse: parseList,
        missingMessage: '--react requires a configured major version.',
      },
    },
  });
}

function fixturePackagePath(fixture) {
  return join(repoRoot, fixture.directory, 'package.json');
}

function loadFixturePackages() {
  return new Map(
    Object.entries(contract.fixtures || {}).map(([fixtureName, fixture]) => [
      fixtureName,
      readJson(fixturePackagePath(fixture)),
    ]),
  );
}

function selectedFixtureNames(requestedNames) {
  const availableNames = Object.keys(contract.fixtures || {});
  if (!requestedNames.length) return availableNames;

  const unknown = requestedNames.filter(
    (fixtureName) => !availableNames.includes(fixtureName),
  );
  if (unknown.length) {
    throw new Error(
      `Unknown consumer fixture "${unknown[0]}". Available: ${availableNames.join(', ')}`,
    );
  }

  return Array.from(new Set(requestedNames));
}

function selectedReactMajors(requestedMajors) {
  const configuredVersions = contract.reactMatrix?.versions || {};
  const availableMajors = Object.keys(configuredVersions);
  if (!requestedMajors.length) return availableMajors;

  const unknown = requestedMajors.filter((major) => !configuredVersions[major]);
  if (unknown.length) {
    throw new Error(
      `Unsupported React fixture version "${unknown[0]}". Accepted: ${availableMajors.join(', ')}`,
    );
  }

  return Array.from(new Set(requestedMajors));
}

function fixtureRuns(fixtureNames, reactMajors) {
  const reactFixture = contract.reactMatrix?.fixture;
  const runs = [];

  for (const fixtureName of fixtureNames) {
    if (fixtureName === reactFixture) {
      for (const reactMajor of selectedReactMajors(reactMajors)) {
        runs.push({ fixtureName, reactMajor });
      }
    } else {
      runs.push({ fixtureName });
    }
  }

  if (reactMajors.length && !fixtureNames.includes(reactFixture)) {
    throw new Error(
      `--react can only be used with the "${reactFixture}" fixture.`,
    );
  }

  return runs;
}

function copyFixture(fixture, projectDir) {
  cpSync(join(repoRoot, fixture.source), projectDir, {
    force: true,
    recursive: true,
  });
  cpSync(join(repoRoot, fixture.directory), projectDir, {
    force: true,
    recursive: true,
  });
}

function writeConsumerManifest(projectDir, tarballPath, reactMajor) {
  const manifestPath = join(projectDir, 'package.json');
  const manifest = readJson(manifestPath);
  manifest.dependencies = {
    ...(manifest.dependencies || {}),
    '@emulsify/core': `file:${tarballPath}`,
  };

  if (reactMajor) {
    const reactVersion = contract.reactMatrix.versions[reactMajor];
    manifest.dependencies.react = reactVersion;
    manifest.dependencies['react-dom'] = reactVersion;
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function fixtureRunOptions(cwd, failureMessage) {
  return {
    cwd,
    echoOutputOnFailure: true,
    env: {
      ...process.env,
      CI: '1',
      FORCE_COLOR: '0',
      NODE_OPTIONS: '--no-deprecation',
    },
    failureMessage,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
}

function assertExtractedPackage(projectDir) {
  const installedPackageRoot = join(projectDir, 'node_modules/@emulsify/core');

  if (lstatSync(installedPackageRoot).isSymbolicLink()) {
    throw new Error(
      `Packed consumer resolved @emulsify/core through a symlink: ${installedPackageRoot}`,
    );
  }

  const relativeToSource = relative(
    realpathSync(repoRoot),
    realpathSync(installedPackageRoot),
  );
  if (
    relativeToSource === '' ||
    (!relativeToSource.startsWith('..') && !isAbsolute(relativeToSource))
  ) {
    throw new Error(
      `Packed consumer resolved @emulsify/core into the source checkout: ${installedPackageRoot}`,
    );
  }
}

function assertHoistedDependencies(projectDir, fixtureName) {
  for (const [dependency, scripts] of Object.entries(
    contract.dependencies || {},
  )) {
    const dependencyManifest = join(
      projectDir,
      'node_modules',
      dependency,
      'package.json',
    );
    if (!existsSync(dependencyManifest)) {
      throw new Error(
        `Consumer fixture "${fixtureName}" cannot resolve contract dependency "${dependency}" from npm's flat node_modules layout (scripts: ${scripts.join(', ')}).`,
      );
    }
  }
}

function assertReactVersion(projectDir, reactMajor) {
  if (!reactMajor) return;

  const expectedVersion = contract.reactMatrix.versions[reactMajor];
  for (const packageName of ['react', 'react-dom']) {
    const installedVersion = readJson(
      join(projectDir, 'node_modules', packageName, 'package.json'),
    ).version;
    if (installedVersion !== expectedVersion) {
      throw new Error(
        `React ${reactMajor} fixture expected ${packageName}@${expectedVersion} but installed ${installedVersion}.`,
      );
    }
  }
}

function assertFixtureOutput(projectDir, fixtureName, fixture) {
  for (const outputPath of fixture.assert || []) {
    if (!existsSync(join(projectDir, outputPath))) {
      throw new Error(
        `Consumer fixture "${fixtureName}" is missing expected output: ${outputPath}`,
      );
    }
  }

  if (fixture.stories?.length) {
    const index = readJson(join(projectDir, '.out/index.json'));
    for (const storyId of fixture.stories) {
      if (!index.entries?.[storyId]) {
        throw new Error(
          `Consumer fixture "${fixtureName}" is missing Storybook story: ${storyId}`,
        );
      }
    }
  }
}

function runConsumerFixture({
  fixtureName,
  reactMajor,
  suiteDir,
  tarballPath,
}) {
  const fixture = contract.fixtures[fixtureName];
  const suffix = reactMajor ? `-react-${reactMajor}` : '';
  const label = `${fixtureName}${suffix}`;
  const projectDir = mkdtempSync(join(suiteDir, `${label}-`));

  console.log(`\nConsumer fixture: ${label}`);

  try {
    copyFixture(fixture, projectDir);
    writeConsumerManifest(projectDir, tarballPath, reactMajor);

    run('npm', ['install', '--no-audit', '--no-fund'], {
      ...fixtureRunOptions(
        projectDir,
        `npm install failed for consumer fixture "${label}".`,
      ),
    });

    assertExtractedPackage(projectDir);
    assertHoistedDependencies(projectDir, label);
    assertReactVersion(projectDir, reactMajor);

    for (const scriptName of fixture.verify) {
      run('npm', ['run', scriptName], {
        ...fixtureRunOptions(
          projectDir,
          `Consumer fixture "${label}" failed npm run ${scriptName}.`,
        ),
      });
    }

    assertFixtureOutput(projectDir, label, fixture);
    console.log(`Consumer fixture passed: ${label}`);
  } finally {
    rmSync(projectDir, { force: true, recursive: true });
  }
}

function packCore(suiteDir) {
  const output = run(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', suiteDir],
    {
      cwd: repoRoot,
      mode: 'exec',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  const [pack] = JSON.parse(output);

  return isAbsolute(pack.filename)
    ? pack.filename
    : join(suiteDir, pack.filename);
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }

  const fixturePackages = loadFixturePackages();
  assertContractDependencies(contract, packageJson, fixturePackages);
  assertProvidedBinaries(contract, packageJson);
  assertFixtureCoverage(contract, fixturePackages);

  if (options.list) {
    for (const fixtureName of Object.keys(contract.fixtures || {})) {
      console.log(fixtureName);
    }
    return;
  }

  const fixtureNames = selectedFixtureNames(options.fixtureNames);
  const runs = fixtureRuns(fixtureNames, options.reactMajors);
  const suiteDir = mkdtempSync(join(tmpdir(), 'emulsify-consumers-'));

  try {
    const tarballPath = packCore(suiteDir);
    for (const fixtureRun of runs) {
      runConsumerFixture({ ...fixtureRun, suiteDir, tarballPath });
    }
  } finally {
    rmSync(suiteDir, { force: true, recursive: true });
  }

  console.log('\nAll packed consumer fixtures passed.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}
