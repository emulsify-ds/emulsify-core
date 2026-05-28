/**
 * @file Smoke tests for the package public exports map.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');
const packageRoot = join(__dirname, '..');
const SINGLE_QUOTE = String.fromCharCode(39);
const DOUBLE_QUOTE = '"';

function normalizePackagePath(filePath) {
  return posix.normalize(filePath).replace(/^\.\//, '');
}

function isPackagedFile(filePath, packageFiles) {
  const normalized = normalizePackagePath(filePath);

  return packageFiles.some((entry) => {
    if (entry === normalized) return true;
    if (entry.endsWith('/**/*')) {
      return normalized.startsWith(entry.replace('/**/*', '/'));
    }
    return false;
  });
}

function isRelativeJsSpecifier(value) {
  return (
    (value.startsWith('./') || value.startsWith('../')) && value.endsWith('.js')
  );
}

function isImportContext(source, quoteIndex) {
  const context = source.slice(Math.max(0, quoteIndex - 200), quoteIndex);

  return (
    context.includes('import') ||
    context.includes('export') ||
    context.includes('from')
  );
}

function collectRelativeJsSpecifiers(source) {
  const specifiers = new Set();

  for (const quote of [SINGLE_QUOTE, DOUBLE_QUOTE]) {
    let quoteIndex = source.indexOf(quote);

    while (quoteIndex !== -1) {
      const endIndex = source.indexOf(quote, quoteIndex + 1);
      if (endIndex === -1) break;

      const specifier = source.slice(quoteIndex + 1, endIndex);
      if (
        isRelativeJsSpecifier(specifier) &&
        isImportContext(source, quoteIndex)
      ) {
        specifiers.add(specifier);
      }

      quoteIndex = source.indexOf(quote, endIndex + 1);
    }
  }

  return Array.from(specifiers);
}

function collectExportTargets(exportValue, targets = new Set()) {
  if (typeof exportValue === 'string') {
    targets.add(normalizePackagePath(exportValue));
    return targets;
  }

  if (!exportValue || typeof exportValue !== 'object') {
    return targets;
  }

  for (const value of Object.values(exportValue)) {
    collectExportTargets(value, targets);
  }

  return targets;
}

function dryRunPackFiles() {
  const output = execFileSync(
    'npm',
    ['pack', '--dry-run', '--ignore-scripts', '--json'],
    {
      cwd: packageRoot,
      encoding: 'utf8',
    },
  );
  const [pack] = JSON.parse(output);

  return pack.files.map(({ path: filePath }) => normalizePackagePath(filePath));
}

describe('@emulsify/core package exports', () => {
  it('imports each public export with native Node ESM resolution', () => {
    const checks = [
      ['@emulsify/core', ['react', 'twig']],
      ['@emulsify/core/extensions', ['react', 'twig']],
      [
        '@emulsify/core/extensions/twig',
        ['getTwigFunctionMap', 'registerTwigExtensions'],
      ],
      [
        '@emulsify/core/extensions/react',
        ['createReactExtensionRegistry', 'defineReactExtension'],
      ],
      [
        '@emulsify/core/storybook',
        ['renderHtmlStoryResult', 'renderTwig', 'TwigHtmlStory', 'TwigStory'],
      ],
      ['@emulsify/core/vite', ['default']],
      [
        '@emulsify/core/vite/plugins',
        ['makePlugins', 'makeTwigNamespaces', 'makeTwigPluginOptions'],
      ],
    ];
    const script = `
      const checks = ${JSON.stringify(checks)};
      for (const [specifier, expectedExports] of checks) {
        const module = await import(specifier);
        for (const exportName of expectedExports) {
          if (module[exportName] === undefined) {
            throw new Error(\`Missing \${exportName} from \${specifier}\`);
          }
        }
      }
      const { renderTwig } = await import('@emulsify/core/storybook');
      if (typeof renderTwig !== 'function') {
        throw new Error('renderTwig is not a function');
      }
      try {
        await import('@emulsify/core/config/vite/project-config.js');
        throw new Error('Internal project-config import unexpectedly succeeded');
      } catch (error) {
        if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
          throw error;
        }
      }
    `;

    expect(() => {
      execFileSync(process.execPath, ['--input-type=module', '--eval', script]);
    }).not.toThrow();
  });

  it('exposes renderTwig from the Storybook public entry', async () => {
    const { renderTwig } = await import('@emulsify/core/storybook');

    expect(typeof renderTwig).toBe('function');
  });

  it('does not expose internal implementation subpaths to Jest resolution', async () => {
    await expect(
      import('@emulsify/core/config/vite/project-config.js'),
    ).rejects.toThrow();
  });

  it('packages relative JavaScript imports used by packaged files', () => {
    const packageFiles = packageJson.files.map(normalizePackagePath);
    const packageJsFiles = packageFiles.filter(
      (filePath) => filePath.endsWith('.js') && !filePath.includes('*'),
    );
    const missingImports = [];

    for (const filePath of packageJsFiles) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const source = readFileSync(join(packageRoot, filePath), 'utf8');

      for (const specifier of collectRelativeJsSpecifiers(source)) {
        const resolvedPath = normalizePackagePath(
          posix.join(posix.dirname(filePath), specifier),
        );

        if (resolvedPath.startsWith('../')) continue;

        if (!isPackagedFile(resolvedPath, packageFiles)) {
          missingImports.push(
            `${filePath} imports ${specifier} (${resolvedPath})`,
          );
        }
      }
    }

    expect(missingImports).toEqual([]);
  });

  it('packs documented public entry points without release-only files', () => {
    const packFiles = dryRunPackFiles();
    const packFileSet = new Set(packFiles);
    const requiredFiles = [
      'package.json',
      'README.md',
      'LICENSE',
      '.cli/init.js',
      '.storybook/main.js',
      '.storybook/preview.js',
      'config/vite/vite.config.js',
      'config/vite/plugins.js',
      'src/storybook/index.js',
      'src/extensions/index.js',
      'src/extensions/react/index.js',
      'src/extensions/twig/index.js',
    ];
    const forbiddenFiles = [
      '.github/workflows/lint.yml',
      'config/jest.config.js',
      'config/jest-transform-import-meta-url.js',
      'config/vite/test-utils/virtual-twig-asset-sources.js',
      'config/vite/test-utils/virtual-twig-globs.js',
      'release.config.cjs',
      'scripts/bump-version-from-commits.js',
      'scripts/release-fixtures.js',
    ];
    const forbiddenPrefixes = [
      '.coverage/',
      '.github/',
      '.out/',
      'coverage/',
      'dist/',
      'src/components/',
    ];
    const forbiddenSuffixes = ['.test.js', '.test.jsx'];

    for (const filePath of requiredFiles) {
      expect(packFileSet.has(filePath)).toBe(true);
    }

    for (const exportTarget of collectExportTargets(packageJson.exports)) {
      expect(packFileSet.has(exportTarget)).toBe(true);
    }

    for (const filePath of forbiddenFiles) {
      expect(packFileSet.has(filePath)).toBe(false);
    }

    const accidentalFiles = packFiles.filter(
      (filePath) =>
        forbiddenPrefixes.some((prefix) => filePath.startsWith(prefix)) ||
        forbiddenSuffixes.some((suffix) => filePath.endsWith(suffix)),
    );

    expect(accidentalFiles).toEqual([]);
  });
});
