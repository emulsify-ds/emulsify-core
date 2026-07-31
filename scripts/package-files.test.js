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
 * This is the same check reduced to static analysis: walk the relative imports
 * reachable from every published entry point and confirm each resolved file is
 * covered by the allowlist. No packing, no install, no network — it runs with the
 * unit tests, which is early enough to matter.
 */

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

/**
 * Convert one `files` entry into a predicate over repository-relative paths.
 *
 * npm's allowlist syntax is broader than this, but the package only uses literal
 * paths, directory prefixes, and `**` globs, so those are what is interpreted.
 *
 * @param {string} entry - A `files` entry, without any leading `!`.
 * @returns {(path: string) => boolean} Matcher.
 */
function entryMatcher(entry) {
  const normalized = entry.replace(/^\.\//, '');

  if (!normalized.includes('*')) {
    // A bare directory name publishes everything beneath it.
    return (path) => path === normalized || path.startsWith(`${normalized}/`);
  }

  const pattern = normalized
    .split('/')
    .map((segment) => {
      if (segment === '**') return '.*';
      return segment.split('*').map(escapeRegExp).join('[^/]*');
    })
    .join('/')
    .replace(/\.\*\//g, '(?:.*/)?');

  const expression = new RegExp(`^${pattern}$`);

  return (path) => expression.test(path);
}

/**
 * Escape regular expression metacharacters in a literal path segment.
 *
 * @param {string} value - Literal text.
 * @returns {string} Escaped text.
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a predicate that reports whether a path would be published.
 *
 * @param {string[]} files - The `files` allowlist.
 * @returns {(path: string) => boolean} Predicate.
 */
function createPublishedCheck(files) {
  const included = files
    .filter((entry) => !entry.startsWith('!'))
    .map(entryMatcher);
  const excluded = files
    .filter((entry) => entry.startsWith('!'))
    .map((entry) => entryMatcher(entry.slice(1)));

  return (path) =>
    included.some((matches) => matches(path)) &&
    !excluded.some((matches) => matches(path));
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
  const isPublished = createPublishedCheck(packageJson.files || []);

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
    // The allowlist exists to keep these out; a matcher bug that made everything
    // look published would hide real omissions.
    expect(
      isPublished('config/vite/plugins/__tests__/reporter-facts.test.js'),
    ).toBe(false);
    expect(isPublished('scripts/audit/checks/__tests__/a.test.js')).toBe(false);
    expect(isPublished('scripts/package-files.test.js')).toBe(false);
  });

  it('interprets the globs the allowlist actually uses', () => {
    expect(isPublished('assets/images/logo.svg')).toBe(true);
    expect(isPublished('scripts/audit/checks/thing.js')).toBe(true);
    expect(isPublished('scripts/audit/checks/thing.test.js')).toBe(false);
  });
});
