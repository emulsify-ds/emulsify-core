/**
 * @file Keep installer approvals effective for locked versions and bounded.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const npmRequire = createRequire(require.resolve('npm/package.json'));
const isScriptAllowed = npmRequire('@npmcli/arborist/lib/script-allowed.js');
const { allowScripts } = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf8'),
);
const { packages } = JSON.parse(
  readFileSync(join(packageRoot, 'package-lock.json'), 'utf8'),
);
const installers = Object.entries(packages)
  .filter(([, metadata]) => metadata.hasInstallScript)
  .map(([location, metadata]) => ({
    name: location.split('node_modules/').at(-1),
    ...metadata,
  }));

describe('locked install-script approvals', () => {
  it.each(installers)(
    'approves $name@$version using npm trusted lockfile identity',
    ({ name, version, resolved, integrity }) => {
      expect(integrity).toMatch(/^sha512-/);
      expect(
        isScriptAllowed(
          {
            version,
            resolved,
            isRegistryDependency: true,
            edgesIn: new Set([{ name, spec: version }]),
          },
          allowScripts,
        ),
      ).toBe(true);
    },
  );

  it.each(installers)(
    'leaves an unreviewed future version of $name unapproved',
    ({ name }) => {
      const version = '999.0.0';
      const basename = name.split('/').at(-1);
      expect(
        isScriptAllowed(
          {
            version,
            resolved: `https://registry.npmjs.org/${name}/-/${basename}-${version}.tgz`,
            isRegistryDependency: true,
          },
          allowScripts,
        ),
      ).toBeNull();
    },
  );

  it('keeps every approval pinned to a version present in the lockfile', () => {
    const locked = new Set(
      Object.entries(packages).map(
        ([location, metadata]) =>
          `${location.split('node_modules/').at(-1)}@${metadata.version}`,
      ),
    );
    for (const [spec, allowed] of Object.entries(allowScripts)) {
      expect(allowed).toBe(true);
      expect(locked.has(spec)).toBe(true);
    }
  });
});
