/** Reproduce the permission failure using only disposable, upstream packages. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fixture = fs.mkdtempSync(
  path.join(os.tmpdir(), 'emulsify-resolver-permissions-'),
);
const cache = process.env.npm_config_cache;
function run(command, args, cwd, expected = 0) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (expected !== null)
    assert.equal(
      result.status,
      expected,
      `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`,
    );
  return result;
}
function npm(args, cwd, expected) {
  return run(
    'npm',
    [...args, ...(cache ? ['--cache', cache] : [])],
    cwd,
    expected,
  );
}
fs.writeFileSync(
  path.join(fixture, 'package.json'),
  JSON.stringify({
    private: true,
    dependencies: { 'napi-postinstall': '0.3.4' },
  }),
);
npm(['install', '--foreground-scripts'], fixture);
const helperPackage = path.join(
  fixture,
  'node_modules/napi-postinstall/package.json',
);
const helper = JSON.parse(fs.readFileSync(helperPackage));
const helperBin = path.resolve(
  path.dirname(helperPackage),
  typeof helper.bin === 'string' ? helper.bin : helper.bin['napi-postinstall'],
);
// This is a deliberately damaged fixture. Never change the project's node_modules.
fs.chmodSync(helperBin, fs.statSync(helperBin).mode & ~0o111);
assert.equal(fs.statSync(helperBin).mode & 0o111, 0);
const results = [];
for (const version of ['1.11.1', '1.12.1', '1.12.2']) {
  const packed = JSON.parse(
    npm(
      [
        'pack',
        `unrs-resolver@${version}`,
        '--json',
        '--pack-destination',
        fixture,
      ],
      fixture,
    ).stdout,
  )[0];
  const packagePath = path.join(fixture, 'node_modules/unrs-resolver');
  fs.rmSync(packagePath, { force: true, recursive: true });
  fs.mkdirSync(packagePath);
  run(
    'tar',
    [
      '-xzf',
      path.join(fixture, packed.filename),
      '--strip-components=1',
      '-C',
      packagePath,
    ],
    fixture,
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(packagePath, 'package.json')),
  );
  const result = npm(
    ['run', 'postinstall', '--prefix', packagePath, '--foreground-scripts'],
    fixture,
    null,
  );
  if (version === '1.11.1') {
    assert.equal(
      manifest.scripts.postinstall,
      'napi-postinstall unrs-resolver 1.11.1 check',
    );
    // dash reports 127 for a non-executable command found through PATH; bash
    // reports 126. Both must actually report the same permission denial.
    assert.ok(
      [126, 127].includes(result.status),
      result.stdout + result.stderr,
    );
    assert.match(result.stderr, /Permission denied/);
    const bash = npm(
      [
        'run',
        'postinstall',
        '--prefix',
        packagePath,
        '--script-shell=/bin/bash',
      ],
      fixture,
      null,
    );
    assert.equal(bash.status, 126, bash.stdout + bash.stderr);
    assert.match(bash.stderr, /Permission denied/);
  } else {
    assert.equal(manifest.scripts.postinstall, 'node postinstall.js');
    assert.match(
      fs.readFileSync(path.join(packagePath, 'postinstall.js'), 'utf8'),
      /checkAndPreparePackage/,
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  assert.equal(
    fs.statSync(helperBin).mode & 0o111,
    0,
    'fixture CLI permissions must remain identical',
  );
  results.push({
    version,
    postinstall: manifest.scripts.postinstall,
    status: result.status,
    permissionDenied: /Permission denied/.test(result.stderr),
    integrity: packed.integrity,
  });
}
const evidence = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  fixture,
  helper: 'napi-postinstall@0.3.4',
  helperExecutable: false,
  results,
};
fs.writeFileSync(
  path.join(fixture, 'evidence.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(JSON.stringify(evidence, null, 2));
