/** Install the real packed release in fresh and historical 3.x consumers. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');

const tarball = path.resolve(process.argv[2] || '');
assert.ok(
  process.argv[2] && fs.statSync(tarball).isFile(),
  'Usage: node scripts/verify-maintenance-consumer.cjs /absolute/path/core-3.5.1.tgz [new-fixture-directory]',
);
const fixture = process.argv[3]
  ? path.resolve(process.argv[3])
  : fs.mkdtempSync(path.join(os.tmpdir(), 'emulsify-maintenance-consumer-'));
if (process.argv[3]) fs.mkdirSync(fixture); // Fail rather than modify an existing consumer.
const cache = process.env.npm_config_cache;
function npm(args, cwd, label, allowed = [0]) {
  const result = spawnSync(
    'npm',
    [...args, ...(cache ? ['--cache', cache] : [])],
    { cwd, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 },
  );
  fs.writeFileSync(
    path.join(cwd, `${label}.log`),
    `${result.stdout || ''}\n${result.stderr || ''}`,
  );
  if (result.error) throw result.error;
  assert.ok(
    allowed.includes(result.status),
    `${label}: npm ${args.join(' ')} failed (${result.status}); inspect ${cwd}/${label}.log`,
  );
  return result;
}
function makeConsumer(name) {
  const cwd = path.join(fixture, name);
  fs.mkdirSync(cwd);
  fs.writeFileSync(
    path.join(cwd, 'package.json'),
    JSON.stringify(
      { name: `emulsify-${name}-fixture`, version: '1.0.0', private: true },
      null,
      2,
    ),
  );
  return cwd;
}
function chain(cwd) {
  let owner = path.join(cwd, 'package.json');
  const graph = [];
  for (const name of [
    '@emulsify/core',
    'jest',
    '@jest/core',
    'jest-resolve',
    'unrs-resolver',
    'napi-postinstall',
  ]) {
    const file = createRequire(owner).resolve(`${name}/package.json`);
    const manifest = JSON.parse(fs.readFileSync(file));
    graph.push({
      name,
      version: manifest.version,
      path: path.relative(cwd, file),
      postinstall: manifest.scripts?.postinstall,
    });
    if (name === '@emulsify/core') {
      assert.equal(manifest.version, '3.5.1');
      assert.ok(
        /^\^30\.5\.[1-9]\d*$/.test(manifest.dependencies.jest),
        'Core must raise the direct Jest minimum',
      );
      assert.equal(
        manifest.dependencies.jest,
        manifest.dependencies['jest-environment-jsdom'],
      );
      assert.equal(
        manifest.overrides,
        undefined,
        'consumer fix must not rely on dependency-local overrides',
      );
    }
    if (name === 'unrs-resolver') {
      assert.notEqual(manifest.version, '1.11.1');
      assert.equal(manifest.scripts.postinstall, 'node postinstall.js');
    }
    owner = file;
  }
  npm(['ls', '--all', '--json'], cwd, 'peer-tree');
  npm(
    [
      'ls',
      'jest',
      '@jest/core',
      'jest-resolve',
      'unrs-resolver',
      'napi-postinstall',
      '--all',
    ],
    cwd,
    'resolver-tree',
  );
  npm(['explain', 'unrs-resolver'], cwd, 'resolver-explain');
  npm(['audit', '--json'], cwd, 'audit', [0, 1]);
  return graph;
}
const fresh = makeConsumer('fresh');
npm(['install', tarball, '--foreground-scripts'], fresh, 'install');
const freshGraph = chain(fresh);
const upgrade = makeConsumer('upgrade');
// npm's supported historical resolution reconstructs the published April 2026
// consumer. No overrides, resolver pins, or hand-edited lockfiles are involved.
npm(
  [
    'install',
    '@emulsify/core@3.5.0',
    '--package-lock-only',
    '--before=2026-04-13T00:00:00.000Z',
  ],
  upgrade,
  'historical-lock',
);
const oldLock = JSON.parse(
  fs.readFileSync(path.join(upgrade, 'package-lock.json')),
);
assert.equal(oldLock.packages['node_modules/@emulsify/core'].version, '3.5.0');
assert.equal(oldLock.packages['node_modules/jest'].version, '30.3.0');
assert.equal(oldLock.packages['node_modules/unrs-resolver'].version, '1.11.1');
fs.copyFileSync(
  path.join(upgrade, 'package-lock.json'),
  path.join(upgrade, 'package-lock-3.5.0.json'),
);
npm(['install', tarball, '--foreground-scripts'], upgrade, 'upgrade');
const upgradeGraph = chain(upgrade);
npm(['ci', '--foreground-scripts'], upgrade, 'ci');
const ciGraph = chain(upgrade);
assert.deepEqual(
  ciGraph,
  upgradeGraph,
  'npm ci must reproduce the upgraded graph',
);
const evidence = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  tarball,
  fixture,
  historical: {
    core: '3.5.0',
    jest: '30.3.0',
    resolver: '1.11.1',
    before: '2026-04-13T00:00:00.000Z',
  },
  freshGraph,
  upgradeGraph,
  ciGraph,
};
fs.writeFileSync(
  path.join(fixture, 'evidence.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(JSON.stringify(evidence, null, 2));
