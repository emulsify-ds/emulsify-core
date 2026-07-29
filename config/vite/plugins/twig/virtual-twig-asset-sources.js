/**
 * @file Virtual Twig text asset source module for Storybook source().
 *
 * Text asset globs are lazy so Storybook does not keep every raw asset string
 * resident unless a Twig template calls `source('@assets/...')`.
 */

import { readFileSync, readdirSync } from 'fs';
import { relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { safeExists } from '../../utils/fs-safe.js';
import { toPosixPath } from '../../utils/paths.js';
import { unique } from '../../../../src/extensions/shared/lists.js';
import { toRootRelativePath } from '../../../../src/extensions/shared/root-relative.js';
import { INLINE_ASSET_EXTS } from '../../../../src/storybook/twig/constants.js';

export const VIRTUAL_TWIG_ASSET_SOURCES_ID =
  'virtual:emulsify-twig-asset-sources';
const RESOLVED_VIRTUAL_TWIG_ASSET_SOURCES_ID = `\0${VIRTUAL_TWIG_ASSET_SOURCES_ID}`;
const VIRTUAL_TWIG_ASSET_SOURCE_RUNTIME_ID =
  'virtual:emulsify-twig-asset-source-runtime';
const RESOLVED_VIRTUAL_TWIG_ASSET_SOURCE_RUNTIME_ID = `\0${VIRTUAL_TWIG_ASSET_SOURCE_RUNTIME_ID}`;
const ASSET_SOURCE_RUNTIME_URL = new URL(
  '../../../../src/storybook/twig/asset-source-runtime.js',
  import.meta.url,
);
const ASSET_SOURCE_RUNTIME_PATH = fileURLToPath(ASSET_SOURCE_RUNTIME_URL);
const GENERATED_ASSET_ALIASES = new Set(['icons.svg']);
const GENERATED_ASSET_ROOTS = ['/dist/assets'];
const PUBLIC_ASSET_ROOTS = new Map([
  ['/assets', '/assets'],
  ['/dist/assets', '/assets'],
]);

/**
 * Resolve a configured asset root to an absolute filesystem path.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string} assetRoot - Absolute, project-relative, or Vite root-relative asset root.
 * @returns {string} Absolute filesystem path.
 */
function toAbsoluteAssetRoot(projectDir, assetRoot) {
  const normalizedProjectDir = toPosixPath(projectDir || '').replace(
    /\/+$/,
    '',
  );
  const normalizedRoot = toPosixPath(assetRoot || '').replace(/\/+$/, '');

  if (!normalizedRoot) return '';
  if (
    normalizedProjectDir &&
    (normalizedRoot === normalizedProjectDir ||
      normalizedRoot.startsWith(`${normalizedProjectDir}/`))
  ) {
    return normalizedRoot;
  }
  if (normalizedRoot.startsWith('/') && normalizedProjectDir) {
    if (safeExists(normalizedRoot)) {
      return normalizedRoot;
    }
    return `${normalizedProjectDir}${normalizedRoot}`;
  }

  return toPosixPath(resolve(projectDir || '.', normalizedRoot));
}

/**
 * Resolve existing project asset roots for Storybook source() text imports.
 *
 * @param {{ projectDir?: string, projectStructure?: { assetRoots?: string[] } }} env - Emulsify environment.
 * @returns {string[]} Existing Vite root-relative asset root paths.
 */
export function assetSourceRoots(env) {
  const configuredRoots =
    Array.isArray(env?.projectStructure?.assetRoots) &&
    env.projectStructure.assetRoots.length
      ? env.projectStructure.assetRoots
      : [];
  const fallbackRoots = ['/assets', '/src/assets'];

  return unique(
    [...configuredRoots, ...fallbackRoots]
      .map((root) => toAbsoluteAssetRoot(env?.projectDir, root))
      .filter((root) => root && safeExists(root))
      .map((root) => toRootRelativePath(env?.projectDir, root))
      .filter(Boolean),
  );
}

/**
 * Resolve generated asset roots for Storybook source() text imports.
 *
 * Generated aliases such as `@assets/icons.svg` resolve through these roots
 * before checking project-authored root assets.
 *
 * @param {{ projectDir?: string }} env - Emulsify environment.
 * @returns {string[]} Existing Vite root-relative generated asset roots.
 */
export function generatedAssetSourceRoots(env) {
  return unique(
    GENERATED_ASSET_ROOTS.map((root) =>
      toAbsoluteAssetRoot(env?.projectDir, root),
    )
      .filter((root) => root && safeExists(root))
      .map((root) => toRootRelativePath(env?.projectDir, root))
      .filter(Boolean),
  );
}

function generatedAssetRootPrefixes() {
  return GENERATED_ASSET_ROOTS.map((root) =>
    `${root}/`.replace(/\/{2,}/g, '/'),
  );
}

/**
 * Build Vite glob patterns from text asset roots.
 *
 * @param {{ projectDir?: string, projectStructure?: { assetRoots?: string[] } }} env - Emulsify environment.
 * @returns {string[]} Root-relative text asset glob patterns.
 */
export function assetSourceGlobPatterns(env) {
  const extensions = Array.from(INLINE_ASSET_EXTS).join(',');

  return [...assetSourceRoots(env), ...generatedAssetSourceRoots(env)].map(
    (root) => `${root === '/' ? '' : root}/**/*.{${extensions}}`,
  );
}

/**
 * Return a public URL base for asset roots served by Storybook staticDirs.
 *
 * @param {string} root - Vite root-relative asset source root.
 * @returns {string} Public URL base, or an empty string for non-public roots.
 */
function publicAssetBaseForRoot(root) {
  const normalizedRoot = `/${String(root || '').replace(/^\/+/, '')}`.replace(
    /\/+$/,
    '',
  );
  const publicBase = PUBLIC_ASSET_ROOTS.get(normalizedRoot);

  return publicBase ? `${publicBase.replace(/\/+$/, '')}/` : '';
}

/**
 * Collect inlineable text assets from a filesystem root.
 *
 * @param {string} absoluteRoot - Absolute filesystem asset root.
 * @returns {string[]} Root-relative file paths.
 */
function collectInlineAssetFiles(absoluteRoot) {
  const files = [];

  const visit = (currentDirectory) => {
    for (const entry of readdirSync(currentDirectory, {
      withFileTypes: true,
    })) {
      const absolutePath = resolve(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const extension = entry.name.split('.').pop().toLowerCase();
      if (INLINE_ASSET_EXTS.has(extension)) {
        files.push(toPosixPath(relative(absoluteRoot, absolutePath)));
      }
    }
  };

  visit(absoluteRoot);
  return files.sort();
}

/**
 * Build fetch-backed entries for public assets that can shadow Vite imports.
 *
 * @param {{ projectDir?: string, projectStructure?: { assetRoots?: string[] } }} env - Emulsify environment.
 * @returns {Array<{ key: string, url: string }>} Source map entries.
 */
export function publicAssetSourceEntries(env) {
  const entries = new Map();
  const roots = unique([
    ...assetSourceRoots(env),
    ...generatedAssetSourceRoots(env),
  ]);

  for (const root of roots) {
    const publicBase = publicAssetBaseForRoot(root);
    if (!publicBase) continue;

    const absoluteRoot = toAbsoluteAssetRoot(env?.projectDir, root);
    if (!absoluteRoot || !safeExists(absoluteRoot)) continue;

    for (const relativeFile of collectInlineAssetFiles(absoluteRoot)) {
      const normalizedFile = relativeFile.replace(/^\/+/, '');
      const key = `${root.replace(/\/+$/, '')}/${normalizedFile}`.replace(
        /\/{2,}/g,
        '/',
      );
      const url = `${publicBase}${normalizedFile}`.replace(/\/{2,}/g, '/');
      entries.set(key, { key, url });
    }
  }

  for (const root of generatedAssetRootPrefixes()) {
    const publicBase = publicAssetBaseForRoot(root);
    if (!publicBase) continue;

    for (const alias of GENERATED_ASSET_ALIASES) {
      const key = `${root.replace(/\/+$/, '')}/${alias}`.replace(
        /\/{2,}/g,
        '/',
      );
      const url = `${publicBase}${alias}`.replace(/\/{2,}/g, '/');
      entries.set(key, { key, url });
    }
  }

  return Array.from(entries.values());
}

/**
 * Generate the virtual module source for lazy text asset maps.
 *
 * @param {{ projectDir?: string, projectStructure?: { assetRoots?: string[] } }} env - Emulsify environment.
 * @returns {string} JavaScript module source.
 */
export function generateVirtualTwigAssetSourcesModule(env) {
  const rootPrefixes = assetSourceRoots(env).map((root) =>
    `${root === '/' ? '' : root}/`.replace(/\/{2,}/g, '/'),
  );
  const generatedRootPrefixes = generatedAssetSourceRoots(env).map((root) =>
    `${root === '/' ? '' : root}/`.replace(/\/{2,}/g, '/'),
  );
  const allGeneratedRootPrefixes = unique([
    ...generatedRootPrefixes,
    ...generatedAssetRootPrefixes(),
  ]);
  const patterns = assetSourceGlobPatterns(env);
  const globEntries = patterns.length
    ? patterns
        .map(
          (pattern) =>
            `  import.meta.glob(${JSON.stringify(pattern)}, { eager: false, query: '?raw', import: 'default' })`,
        )
        .join(',\n')
    : '';
  const fetchEntries = publicAssetSourceEntries(env)
    .map(
      ({ key, url }) =>
        `  ${JSON.stringify(key)}: fetchAssetText(${JSON.stringify(url)})`,
    )
    .join(',\n');

  return `/**
 * Virtual module generated by config/vite/plugins/twig/virtual-twig-asset-sources.js.
 *
 * Raw text assets stay lazy and load only when Twig source() requests them.
 */

import { createAssetSourceRuntime } from '${VIRTUAL_TWIG_ASSET_SOURCE_RUNTIME_ID}';

export const assetRootPrefixes = ${JSON.stringify(rootPrefixes)};
export const generatedAssetRootPrefixes = ${JSON.stringify(allGeneratedRootPrefixes)};
export const generatedAssetAliases = ${JSON.stringify(
    Array.from(GENERATED_ASSET_ALIASES),
  )};

const fetchAssetText = (url) => () =>
  fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(\`\${response.status} while fetching \${url}\`);
    }
    return response.text();
  });

export const assets = Object.assign({}, ...[
${globEntries}
${fetchEntries ? `${globEntries ? ',\n' : ''}{\n${fetchEntries}\n}` : ''}
]);

const assetSourceRuntime = createAssetSourceRuntime({
  assets,
  assetRootPrefixes,
  generatedAssetRootPrefixes,
  generatedAssetAliases,
});

export const coversAssetPath = assetSourceRuntime.coversAssetPath;
export const hasAssetText = assetSourceRuntime.hasAssetText;
export const isAssetTextLoading = assetSourceRuntime.isAssetTextLoading;
export const whenAssetTextLoaded = assetSourceRuntime.whenAssetTextLoaded;
export const getAssetText = assetSourceRuntime.getAssetText;
`;
}

/**
 * Provide `virtual:emulsify-twig-asset-sources` for Storybook source().
 *
 * @param {{ projectDir?: string, projectStructure?: { assetRoots?: string[] } }} env - Emulsify environment.
 * @returns {import('vite').PluginOption} Virtual module plugin.
 */
export function virtualTwigAssetSourcesPlugin(env) {
  return {
    name: 'emulsify-virtual-twig-asset-sources',
    resolveId(id) {
      if (id === VIRTUAL_TWIG_ASSET_SOURCES_ID) {
        return RESOLVED_VIRTUAL_TWIG_ASSET_SOURCES_ID;
      }
      if (id === VIRTUAL_TWIG_ASSET_SOURCE_RUNTIME_ID) {
        return RESOLVED_VIRTUAL_TWIG_ASSET_SOURCE_RUNTIME_ID;
      }

      return null;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_TWIG_ASSET_SOURCES_ID) {
        return generateVirtualTwigAssetSourcesModule(env);
      }
      if (id === RESOLVED_VIRTUAL_TWIG_ASSET_SOURCE_RUNTIME_ID) {
        this.addWatchFile(ASSET_SOURCE_RUNTIME_PATH);
        return readFileSync(ASSET_SOURCE_RUNTIME_PATH, 'utf8');
      }

      return null;
    },
  };
}
