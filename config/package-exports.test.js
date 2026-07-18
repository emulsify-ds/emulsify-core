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

function isRelativeJsSpecifier(value) {
  return (
    (value.startsWith('./') || value.startsWith('../')) &&
    (value.endsWith('.js') || !posix.extname(value))
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

function matchesForbiddenPackagePath(filePath, prefixes, suffixes, segments) {
  return (
    prefixes.some((prefix) => filePath.startsWith(prefix)) ||
    suffixes.some((suffix) => filePath.endsWith(suffix)) ||
    segments.some((segment) => filePath.split('/').includes(segment))
  );
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
        [
          'defineCustomElement',
          'renderHtmlStoryResult',
          'renderTwig',
          'renderWebComponent',
          'TwigHtmlStory',
          'TwigStory',
        ],
      ],
      [
        '@emulsify/core/storybook/twig/include-function',
        ['createTwigIncludeFunction'],
      ],
      [
        '@emulsify/core/storybook/twig/asset-source-runtime',
        ['createAssetSourceRuntime', 'normalizeAssetPath'],
      ],
      ['@emulsify/core/storybook/twig/drupal-filters', ['default']],
      ['@emulsify/core/vite', ['default']],
      [
        '@emulsify/core/vite/plugins',
        ['makePlugins', 'makeTwigNamespaces', 'makeTwigPluginOptions'],
      ],
      [
        '@emulsify/core/vite/platforms',
        ['adapters', 'getPlatformAdapter', 'normalizePlatformName'],
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
    const { defineCustomElement, renderTwig, renderWebComponent } =
      await import('@emulsify/core/storybook');

    expect(typeof defineCustomElement).toBe('function');
    expect(typeof renderTwig).toBe('function');
    expect(typeof renderWebComponent).toBe('function');
  });

  it('does not expose internal implementation subpaths to Jest resolution', async () => {
    await expect(
      import('@emulsify/core/config/vite/project-config.js'),
    ).rejects.toThrow();
  });

  it('packages relative JavaScript imports used by packaged files', () => {
    const packageFiles = dryRunPackFiles();
    const packageFileSet = new Set(packageFiles);
    const packageJsFiles = packageFiles.filter((filePath) =>
      filePath.endsWith('.js'),
    );
    const missingImports = [];

    for (const filePath of packageJsFiles) {
      const source = readFileSync(join(packageRoot, filePath), 'utf8');

      for (const specifier of collectRelativeJsSpecifiers(source)) {
        const resolvedPath = normalizePackagePath(
          posix.join(posix.dirname(filePath), specifier),
        );

        // Some packaged Storybook files intentionally load consumer-project
        // overrides outside the package root.
        if (resolvedPath.startsWith('../')) continue;

        const importCandidates = posix.extname(resolvedPath)
          ? [resolvedPath]
          : [resolvedPath, `${resolvedPath}.js`, `${resolvedPath}/index.js`];
        if (
          !importCandidates.some((candidate) => packageFileSet.has(candidate))
        ) {
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
      'scripts/audit.js',
      'scripts/audit-twig-stories.js',
      'scripts/audit/index.js',
      'scripts/audit/report.js',
      'src/storybook/index.js',
      'src/storybook/render-web-component.js',
      'src/storybook/twig/asset-source-runtime.js',
      'src/extensions/index.js',
      'src/extensions/react/index.js',
      'src/extensions/twig/index.js',
    ];
    const forbiddenFiles = [
      '.github/workflows/lint.yml',
      'config/jest.config.js',
      'config/jest-transform-import-meta-url.js',
      'config/release-analysis.cjs',
      'config/vite/test-utils/virtual-twig-asset-sources.js',
      'config/vite/test-utils/virtual-twig-globs.js',
      'release.config.cjs',
      'scripts/bump-version-from-commits.js',
      'scripts/release-fixtures.js',
      'scripts/smoke-pack.js',
      'scripts/test-custom-element-storybook.js',
      'scripts/verify-release-analysis.js',
    ];
    const forbiddenPrefixes = [
      '.coverage/',
      '.github/',
      '.out/',
      'coverage/',
      'dist/',
      'src/components/',
    ];
    const forbiddenSuffixes = [
      '.snap',
      '.spec.js',
      '.spec.jsx',
      '.spec.ts',
      '.spec.tsx',
      '.test.js',
      '.test.jsx',
      '.test.ts',
      '.test.tsx',
    ];
    const forbiddenSegments = ['__snapshots__'];

    for (const filePath of requiredFiles) {
      expect(packFileSet.has(filePath)).toBe(true);
    }

    for (const exportTarget of collectExportTargets(packageJson.exports)) {
      expect(packFileSet.has(exportTarget)).toBe(true);
    }

    for (const binTarget of Object.values(packageJson.bin)) {
      expect(packFileSet.has(normalizePackagePath(binTarget))).toBe(true);
    }

    for (const filePath of forbiddenFiles) {
      expect(packFileSet.has(filePath)).toBe(false);
    }

    const accidentalFiles = packFiles.filter((filePath) =>
      matchesForbiddenPackagePath(
        filePath,
        forbiddenPrefixes,
        forbiddenSuffixes,
        forbiddenSegments,
      ),
    );

    expect(accidentalFiles).toEqual([]);
  });
});
