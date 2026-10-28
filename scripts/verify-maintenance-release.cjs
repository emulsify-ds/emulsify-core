const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Exercise the documented analysis plugin without invoking publishing hooks or
// creating commits/tags. The final merge must retain a conventional fix subject.
async function main() {
  const cwd = path.resolve(__dirname, '..');
  const config = require('../release.config.cjs');
  const manifest = require('../package.json');
  const baseline = execFileSync(
    'git',
    ['describe', '--tags', '--match', 'v3.*', '--abbrev=0'],
    {
      cwd,
      encoding: 'utf8',
    },
  ).trim();
  assert.equal(baseline, 'v3.5.0');
  const maintenance = config.branches.find((branch) => branch.name === '3.x');
  assert.deepEqual(maintenance, {
    name: '3.x',
    range: '3.x',
    channel: 'legacy-3',
  });
  assert.ok(
    config.branches.includes('main'),
    'Keep the newer release branch configured',
  );
  assert.equal(manifest.publishConfig.tag, maintenance.channel);
  const npmPlugin = config.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === '@semantic-release/npm',
  );
  assert.equal(npmPlugin[1].npmPublish, true);
  const analyzer = config.plugins.find(
    (plugin) =>
      Array.isArray(plugin) &&
      plugin[0] === '@semantic-release/commit-analyzer',
  );
  const { analyzeCommits } = await import('@semantic-release/commit-analyzer');
  const message =
    'fix(deps): refresh 3.x dependencies and repair resolver installation';
  const messages = execFileSync(
    'git',
    ['log', '--format=%B%x00', `${baseline}..HEAD`],
    {
      cwd,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const type = await analyzeCommits(analyzer[1], {
    cwd,
    commits: (messages.length ? messages : [message]).map((entry) => ({
      message: entry,
    })),
    logger: { log() {} },
  });
  assert.equal(type, 'patch');
  const [major, minor, patch] = baseline.slice(1).split('.').map(Number);
  const version = `${major}.${minor}.${patch + 1}`;
  assert.equal(version, '3.5.1');
  assert.equal(manifest.version, version);
  console.log(
    JSON.stringify(
      {
        baseline,
        prospectiveCommit: messages.length ? null : message,
        analyzedCommitCount: messages.length || 1,
        type,
        version,
        branch: maintenance.name,
        channel: maintenance.channel,
        publishingInvoked: false,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
