#!/usr/bin/env node
/**
 * @file Prepare isolated source revisions for opt-in implementation benchmarks.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'v4.4.0' },
    head: { type: 'string', default: 'HEAD' },
    'output-dir': { type: 'string' },
    help: { type: 'boolean' },
  },
});
const git = (...values) =>
  execFileSync('git', values, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
const digest = (value) => createHash('sha256').update(value).digest('hex');

if (values.help) {
  console.log(
    'Usage: node scripts/benchmarks/prepare.mjs --base <ref> --head <ref|working-tree> [--output-dir <new-directory>]',
  );
  process.exitCode = 0;
} else {
  const baseRef = values.base;
  const headRef = values.head;
  const outputDir = values['output-dir'];
  const suiteRoot = outputDir
    ? resolve(outputDir)
    : mkdtempSync(join(tmpdir(), 'emulsify-performance-'));
  if (outputDir) mkdirSync(suiteRoot);
  const dependencyLock = readFileSync(join(repoRoot, 'package-lock.json'));
  const revisions = [];

  for (const [label, ref] of [
    ['base', baseRef],
    ['head', headRef],
  ]) {
    const sha = git(
      'rev-parse',
      `${ref === 'working-tree' ? 'HEAD' : ref}^{commit}`,
    )
      .toString()
      .trim();
    const sourceRoot = join(suiteRoot, label);
    mkdirSync(sourceRoot);
    execFileSync('tar', ['-xf', '-', '-C', sourceRoot], {
      input: git('archive', '--format=tar', sha),
      maxBuffer: 64 * 1024 * 1024,
    });
    let patchSha256 = null;
    if (ref === 'working-tree') {
      // Apply tracked changes only. Untracked benchmark/report artifacts never
      // enter the code under test, and the user's checkout/index stay untouched.
      const patch = git('diff', '--binary', 'HEAD');
      if (patch.length) {
        execFileSync('git', ['apply', '--whitespace=nowarn', '-'], {
          cwd: sourceRoot,
          input: patch,
        });
        patchSha256 = digest(patch);
        writeFileSync(join(suiteRoot, 'working-tree.patch'), patch);
      }
    }
    symlinkSync(
      join(repoRoot, 'node_modules'),
      join(sourceRoot, 'node_modules'),
      'dir',
    );
    revisions.push({
      label,
      ref,
      sha,
      patchSha256,
      sourceRoot,
      sourceLockSha256: digest(
        readFileSync(join(sourceRoot, 'package-lock.json')),
      ),
    });
  }

  const fixtures = Object.fromEntries(
    ['stories', 'resolver', 'a11y'].map((name) => {
      const directory = join(suiteRoot, 'fixtures', name);
      mkdirSync(directory, { recursive: true });
      return [name, directory];
    }),
  );
  const metadata = {
    comparison:
      'Source implementation comparison using one shared dependency installation; not a full release dependency comparison.',
    createdAt: new Date().toISOString(),
    node: process.version,
    npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
    system: {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpus: cpus().length,
      cpu: cpus()[0]?.model,
      totalMemoryBytes: totalmem(),
    },
    dependencyRoot: join(repoRoot, 'node_modules'),
    dependencyLockSha256: digest(dependencyLock),
    installedLockSha256: existsSync(
      join(repoRoot, 'node_modules/.package-lock.json'),
    )
      ? digest(readFileSync(join(repoRoot, 'node_modules/.package-lock.json')))
      : null,
    cachePolicy:
      'Source trees have no generated dist/.out or project caches. OS filesystem caches are not flushed; workers document process and per-run cache resets.',
    revisions,
    fixtures,
  };
  writeFileSync(
    join(suiteRoot, 'metadata.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  console.log(JSON.stringify({ suiteRoot, ...metadata }, null, 2));
}
