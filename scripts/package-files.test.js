/**
 * @file Guards the `files` allowlist against modules it forgot to ship.
 *
 * `package.json` enumerates every published file explicitly. That is the right
 * choice — it keeps fixtures, tests, and tooling out of the tarball — but it
 * means adding a module is two edits, and the second one is invisible. Nothing in
 * the source tree breaks when it is missed. The package installs, resolves its
 * entry point, and then fails in the consumer:
 *
 *   [UNRESOLVED_IMPORT] Could not resolve './verbosity.js' in
 *   node_modules/@emulsify/core/config/vite/plugins/reporter/vite-logger.js
 *
 * `npm run smoke:pack` already catches this, by importing the public entry points
 * out of a real installed tarball. But it packs, installs, and builds Storybook to
 * do it, so it lives in `release:verify` and does not run on a commit. By then the
 * omission has usually been published.
 *
 * This is the same check reduced to the reachability question: walk the relative
 * imports reachable from every published entry point and confirm each resolved
 * file actually lands in the tarball. No install and no network — it runs with the
 * unit tests, which is early enough to matter.
 *
 * The one thing it does shell out for is `npm pack --dry-run`, and that is
 * deliberate. An earlier revision modelled the allowlist itself, treating `files`
 * as include-then-exclude. npm evaluates `files` last-match-wins, so when the
 * array was sorted alphabetically and the `!` entries floated above the positive
 * pattern that re-included them, this test kept passing while npm published 15
 * test modules whose own imports were excluded. Asking npm what it would pack is
 * the only model of `files` that cannot drift from npm.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const packageJson = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf8'),
);

/**
 * Entry points a consumer resolves that are not in the `exports` map.
 *
 * Consumers point Vite and Storybook at these paths directly, by file path rather
 * than by package specifier, so `exports` never mentions them and they still have
 * to be published along with everything they import.
 *
 * @type {string[]}
 */
const DIRECT_ENTRY_POINTS = [
  'config/vite/vite.config.js',
  '.storybook/main.js',
  '.storybook/preview.js',
  '.storybook/ready-reporter.js',
];

/**
 * Matches the specifier in a static import, re-export, or bare import.
 *
 * Only static forms are walked. A dynamic `import()` with a computed specifier
 * cannot be resolved without running the code, and the reporter uses none.
 *
 * @type {RegExp}
 */
const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g;

/** @type {Set<string>|undefined} */
let packedPathCache;

/**
 * Ask npm which files it would publish, as repository-relative POSIX paths.
 *
 * Memoized: the pack costs a few seconds and every assertion in this file wants
 * the same answer. `--ignore-scripts` keeps `prepare` (husky) out of it.
 *
 * @returns {Set<string>} Paths npm would include in the tarball.
 */
function packedPaths() {
  if (packedPathCache) return packedPathCache;

  const output = execFileSync(
    'npm',
    ['pack', '--dry-run', '--ignore-scripts', '--json'],
    { cwd: packageRoot, encoding: 'utf8' },
  );
  const [pack] = JSON.parse(output);

  packedPathCache = new Set(
    pack.files.map(({ path: filePath }) =>
      filePath.replace(/\\/g, '/').replace(/^\.\//, ''),
    ),
  );

  return packedPathCache;
}

/**
 * Build a predicate that reports whether a path would be published.
 *
 * Backed by the real pack manifest rather than an interpretation of `files`, so
 * it answers the question npm answers, including ordering effects this file
 * previously got wrong.
 *
 * @returns {(path: string) => boolean} Predicate.
 */
function createPublishedCheck() {
  const packed = packedPaths();

  return (path) => packed.has(path.replace(/^\.\//, ''));
}

/**
 * Resolve a relative import specifier to a file inside the repository.
 *
 * @param {string} specifier - Relative specifier.
 * @param {string} importerPath - Repository-relative path of the importing file.
 * @returns {string|undefined} Repository-relative path, when it resolves.
 */
function resolveRelative(specifier, importerPath) {
  const absolute = resolve(packageRoot, dirname(importerPath), specifier);

  const candidates = [absolute, `${absolute}.js`, join(absolute, 'index.js')];

  for (const candidate of candidates) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      const relativePath = relative(packageRoot, candidate);
      if (!relativePath.startsWith('..')) return relativePath;
    }
  }

  return undefined;
}

/**
 * Walk every statically reachable local module from a set of entry points.
 *
 * @param {string[]} entryPoints - Repository-relative starting files.
 * @returns {Map<string, string>} Reachable path to the path that imported it.
 */
function walkLocalImports(entryPoints) {
  /** @type {Map<string, string>} */
  const reachable = new Map();
  const queue = [];

  for (const entry of entryPoints) {
    if (!existsSync(join(packageRoot, entry))) continue;
    reachable.set(entry, 'package.json');
    queue.push(entry);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    const source = readFileSync(join(packageRoot, current), 'utf8');

    IMPORT_PATTERN.lastIndex = 0;
    let match = IMPORT_PATTERN.exec(source);

    while (match) {
      const [, specifier] = match;

      if (specifier.startsWith('.')) {
        const resolved = resolveRelative(specifier, current);

        if (resolved && !reachable.has(resolved)) {
          reachable.set(resolved, current);
          queue.push(resolved);
        }
      }

      match = IMPORT_PATTERN.exec(source);
    }
  }

  return reachable;
}

const entryPoints = [
  ...new Set(
    [...Object.values(packageJson.exports || {}), ...DIRECT_ENTRY_POINTS]
      .filter((target) => typeof target === 'string' && target.endsWith('.js'))
      .map((target) => target.replace(/^\.\//, '')),
  ),
];

describe('published files allowlist', () => {
  const isPublished = createPublishedCheck();

  it('resolves the entry points it claims to export', () => {
    // A guard that silently walked nothing would pass forever.
    expect(entryPoints.length).toBeGreaterThan(5);

    for (const entry of entryPoints) {
      expect(existsSync(join(packageRoot, entry))).toBe(true);
    }
  });

  it('publishes every module reachable from an entry point', () => {
    const reachable = walkLocalImports(entryPoints);
    const missing = [...reachable.entries()]
      .filter(([path]) => !isPublished(path))
      .map(([path, importer]) => `${path} (imported by ${importer})`);

    // The failure this prevents is not visible in the source tree: the package
    // builds, installs, and resolves, then dies in the consumer with
    // UNRESOLVED_IMPORT for a file that exists in the repository.
    expect(missing).toEqual([]);
  });

  it('reaches deep enough to cover the reporter modules', () => {
    // Pins the walk against a regression in the walker itself. `verbosity.js` is
    // four hops from `config/vite/vite.config.js` and was the omission that
    // motivated this test.
    const reachable = walkLocalImports(entryPoints);

    expect([...reachable.keys()]).toContain(
      'config/vite/plugins/reporter/verbosity.js',
    );
    expect([...reachable.keys()]).toContain(
      'config/vite/plugins/reporter/render.js',
    );
  });

  it('does not publish tests or fixtures', () => {
    // Every path here is a real file. The previous revision asserted against
    // invented paths like `scripts/audit/checks/thing.test.js`, which a manifest
    // lookup answers `false` for whether or not the allowlist works — the
    // assertion passes because the file does not exist. Asserting existence
    // first keeps a rename from quietly turning these into no-ops.
    const excluded = [
      'config/vite/plugins/__tests__/reporter-facts.test.js',
      'scripts/audit/checks/__tests__/core-imports.test.js',
      'scripts/audit/fix.test.js',
      'scripts/audit/index.test.js',
      'scripts/audit/test-utils.js',
      'scripts/package-files.test.js',
    ];

    for (const path of excluded) {
      expect(existsSync(join(packageRoot, path))).toBe(true);
      expect(isPublished(path)).toBe(false);
    }
  });

  it('publishes the shipped siblings of those excluded files', () => {
    // The counterweight: an allowlist that excluded the whole `scripts/audit`
    // tree would satisfy the test above and break the `emulsify-audit` binary.
    const included = [
      'scripts/audit/index.js',
      'scripts/audit/fix.js',
      'scripts/audit/checks/css-asset-references.js',
      'config/vite/plugins/reporter/verbosity.js',
    ];

    for (const path of included) {
      expect(existsSync(join(packageRoot, path))).toBe(true);
      expect(isPublished(path)).toBe(true);
    }
  });

  it('keeps every negation below the patterns it narrows', () => {
    // npm evaluates `files` last-match-wins. Sorting the array alphabetically
    // floats `!` entries to the top, where a later positive pattern silently
    // re-includes what they exclude. That is exactly how 15 test modules
    // reached the tarball; nothing about the array's appearance reveals it.
    const files = packageJson.files || [];
    const lastPositive = files.reduce(
      (last, entry, index) => (entry.startsWith('!') ? last : index),
      -1,
    );
    const misordered = files
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry, index }) => entry.startsWith('!') && index < lastPositive,
      )
      .map(({ entry }) => entry);

    expect(misordered).toEqual([]);
  });
});
