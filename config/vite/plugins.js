/**
 * @file Vite plugins factory for Emulsify.
 *
 * @description
 *  - Copies TWIGs/metadata into `dist/` using the same routing rules as JS/CSS:
 *      • `src/components/**`         → `dist/components/**`
 *      • `src/!(components|util)/**` → `dist/global/**`
 *  - Copies **all non-code assets** found under `src/` to the same routed locations.
 *  - Builds a **physical** spritemap at `dist/assets/icons.sprite.svg`.
 *  - If `env.platform === 'drupal'` and a `src/` dir exists, mirrors `dist/components/**`
 *    to `./components/**` and prunes any empty folders left behind.
 *
 * Legacy Variant behavior:
 *  - When `env.legacyVariant === true`, we **skip** copying Twig and assets, and also
 *    **skip** mirroring. (Only JS/CSS compile is needed.)
 */

import { resolve, join, dirname, basename } from 'path';
import {
  mkdirSync,
  copyFileSync,
  unlinkSync,
  readdirSync,
  rmdirSync,
  statSync,
  existsSync,
  readFileSync,
} from 'fs';
import { globSync } from 'glob';
import sassGlobImports from 'vite-plugin-sass-glob-import';
import yml from '@modyfi/vite-plugin-yaml';
import twig from 'vite-plugin-twig-drupal';

/* ============================================================================
 * Small, focused helpers
 * ==========================================================================
 */

/** Is a Twig partial (filename starts with `_`)? */
const isPartial = (filePath) =>
  (filePath.split('/')?.pop() || '').trim().startsWith('_');

/** Depth-first walk to list **all files** (no directories) under a given root. */
const walkFiles = (rootDir) => {
  const files = [];
  const stack = [rootDir];

  while (stack.length) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    let entryNames = [];
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      entryNames = readdirSync(currentDir);
    } catch {
      continue; // unreadable directory
    }

    for (const name of entryNames) {
      const fullPath = join(currentDir, name);
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const stats = statSync(fullPath);
        if (stats.isDirectory()) stack.push(fullPath);
        else files.push(fullPath);
      } catch {
        // ignore unreadable entries
      }
    }
  }

  return files;
};

/**
 * Removes empty parent directories from a start directory **up to (but not including)**
 * a stopping boundary directory.
 */
const pruneEmptyDirsUpTo = (startDir, stopAtDir) => {
  const stopAbs = resolve(stopAtDir);
  let cursor = resolve(startDir);

  const isEmpty = (dir) => {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      return readdirSync(dir).length === 0;
    } catch {
      return false;
    }
  };

  while (cursor.startsWith(stopAbs)) {
    if (!isEmpty(cursor)) break;

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      rmdirSync(cursor);
    } catch {
      break;
    }

    const parent = dirname(cursor);
    if (parent === cursor || parent === stopAbs) break;
    cursor = parent;
  }
};

/* ============================================================================
 * Plugin: Copy Twig files (+ component metadata) using JS/CSS-like routing
 * ==========================================================================
 */

function copyTwigFilesPlugin({ srcDir }) {
  let outDir = 'dist';
  const posix = (p) => p.replace(/\\/g, '/');

  return {
    name: 'emulsify-copy-twig-files',
    apply: 'build',
    enforce: 'post',

    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },

    closeBundle() {
      // components/**/*.twig
      const componentTwigs = globSync(
        posix(join(srcDir, 'components/**/*.twig')),
      );

      for (const absPath of componentTwigs) {
        const relFromSrc = posix(absPath).split(posix(srcDir) + '/')[1]; // "components/x/y.twig"
        const withinComponents = relFromSrc.replace(/^components\//, '');
        if (isPartial(withinComponents)) continue;

        const destPath = join(outDir, 'components', withinComponents);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        mkdirSync(dirname(destPath), { recursive: true });
        try {
          copyFileSync(absPath, destPath);
        } catch {
          /* noop */
        }
      }

      // components/**/*.component.(yml|yaml|json)
      for (const pattern of [
        'components/**/*.component.@(yml|yaml)',
        'components/**/*.component.json',
      ]) {
        const metaFiles = globSync(posix(join(srcDir, pattern)));
        for (const absPath of metaFiles) {
          const rel = posix(absPath)
            .split(posix(srcDir) + '/')[1]
            .replace(/^components\//, '');
          const destPath = join(outDir, 'components', rel);
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          mkdirSync(dirname(destPath), { recursive: true });
          try {
            copyFileSync(absPath, destPath);
          } catch {
            /* noop */
          }
        }
      }

      // global Twig → dist/global  (exclude components/, util/, and partials)
      const globalTwigs = globSync(posix(join(srcDir, '**/*.twig')), {
        ignore: [
          posix(join(srcDir, 'components/**')),
          posix(join(srcDir, 'util/**')),
          posix(join(srcDir, '**/_*.twig')),
        ],
      });

      for (const absPath of globalTwigs) {
        const rel = posix(absPath).split(posix(srcDir) + '/')[1];
        const destPath = join(outDir, 'global', rel);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        mkdirSync(dirname(destPath), { recursive: true });
        try {
          copyFileSync(absPath, destPath);
        } catch {
          /* noop */
        }
      }
    },
  };
}

/* ============================================================================
 * Plugin: Copy **all non-code** assets under `src/` with the same routing
 * ==========================================================================
 */

function copyAllSrcAssetsPlugin({ srcDir }) {
  let outDir = 'dist';
  const posix = (p) => p.replace(/\\/g, '/');

  return {
    name: 'emulsify-copy-all-src-assets',
    apply: 'build',
    enforce: 'post',

    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },

    closeBundle() {
      // A) Component-side assets → dist/components
      const componentAssets = globSync(posix(join(srcDir, 'components/**/*')), {
        nodir: true,
        ignore: [
          posix(join(srcDir, 'components/**/*.js')),
          posix(join(srcDir, 'components/**/*.scss')),
          posix(join(srcDir, 'components/**/*.twig')),
          posix(join(srcDir, 'components/**/*.component.@(yml|yaml|json)')),
          posix(join(srcDir, 'components/**/*.map')),
        ],
      });

      for (const absPath of componentAssets) {
        const rel = posix(absPath)
          .split(posix(srcDir) + '/')[1]
          .replace(/^components\//, '');
        const destPath = join(outDir, 'components', rel);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        mkdirSync(dirname(destPath), { recursive: true });
        try {
          copyFileSync(absPath, destPath);
        } catch {
          /* noop */
        }
      }

      // B) Global-side assets → dist/global
      const globalAssets = globSync(posix(join(srcDir, '**/*')), {
        nodir: true,
        ignore: [
          posix(join(srcDir, 'components/**')),
          posix(join(srcDir, 'util/**')),
          posix(join(srcDir, '**/*.js')),
          posix(join(srcDir, '**/*.scss')),
          posix(join(srcDir, '**/*.twig')),
          posix(join(srcDir, '**/*.component.@(yml|yaml|json)')),
          posix(join(srcDir, '**/*.map')),
        ],
      });

      for (const absPath of globalAssets) {
        const rel = posix(absPath).split(posix(srcDir) + '/')[1];
        const destPath = join(outDir, 'global', rel);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        mkdirSync(dirname(destPath), { recursive: true });
        try {
          copyFileSync(absPath, destPath);
        } catch {
          /* noop */
        }
      }
    },
  };
}

/* ============================================================================
 * Plugin: Build a **physical** SVG spritemap at dist/assets/icons.sprite.svg
 * ==========================================================================
 */

function svgSpriteFilePlugin({ include, symbolId = 'icon-[name]' }) {
  const toArray = (x) => (Array.isArray(x) ? x : [x]).filter(Boolean);
  const posix = (p) => p.replace(/\\/g, '/');

  let patterns = [];

  return {
    name: 'emulsify-svg-sprite-file',
    apply: 'build',

    buildStart() {
      patterns = toArray(include).map(posix);
      const files = patterns.flatMap((p) => globSync(p));
      for (const file of files) {
        try {
          this.addWatchFile(file);
        } catch {
          /* noop */
        }
      }
    },

    generateBundle() {
      const files = patterns
        .flatMap((p) => globSync(p))
        .sort((a, b) => posix(a).localeCompare(posix(b)));

      if (!files.length) return;

      const usedIds = new Set();

      const idFor = (absPath) => {
        const stem = basename(absPath).replace(/\.svg$/i, '');
        const base = symbolId.replace('[name]', stem);
        let id = base
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '');

        if (!usedIds.has(id)) {
          usedIds.add(id);
          return id;
        }
        let i = 2;
        while (usedIds.has(`${id}-${i}`)) i += 1;
        id = `${id}-${i}`;
        usedIds.add(id);
        return id;
      };

      const toSymbol = (absPath) => {
        let svg = '';
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          svg = readFileSync(absPath, 'utf8');
        } catch {
          return '';
        }

        const match = svg.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
        const inner = (match ? match[2] : svg)
          .replace(/<\/*symbol[^>]*>/gi, '')
          .replace(/<\/*defs[^>]*>/gi, '')
          .trim();

        const attr = match ? match[1] : '';
        const vb = attr.match(/\bviewBox="([^"]+)"/i);
        const viewBoxAttr = vb ? ` viewBox="${vb[1]}"` : '';

        return `<symbol id="${idFor(absPath)}"${viewBoxAttr}>${inner}</symbol>`;
      };

      const symbols = files.map(toSymbol).filter(Boolean);

      const sprite = [
        '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">',
        ...symbols,
        '</svg>\n',
      ].join('\n');

      this.emitFile({
        type: 'asset',
        fileName: 'assets/icons.sprite.svg',
        source: sprite,
      });
    },
  };
}

/* ============================================================================
 * Plugin: Mirror `dist/components/**` → `./components/**` (Drupal only)
 * ==========================================================================
 */

function mirrorComponentsToRoot({ enabled, projectDir }) {
  let outDir = 'dist';

  return {
    name: 'emulsify-mirror-components-to-root',
    apply: 'build',
    enforce: 'post',

    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },

    closeBundle() {
      if (!enabled) return;

      const distComponents = join(outDir, 'components');
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      if (!existsSync(distComponents)) return;

      for (const srcFile of walkFiles(distComponents)) {
        const relFromOutDir = srcFile.slice(join(outDir, '').length); // "components/.."
        const destFile = join(projectDir, relFromOutDir); // "./components/..."

        // eslint-disable-next-line security/detect-non-literal-fs-filename
        mkdirSync(dirname(destFile), { recursive: true });
        try {
          copyFileSync(srcFile, destFile);

          try {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            unlinkSync(srcFile);
            pruneEmptyDirsUpTo(dirname(srcFile), distComponents);
          } catch {
            /* noop */
          }
        } catch (e) {
          // Keep console here; useful during site builds.

          console.warn(
            `Mirror copy failed for ${relFromOutDir}: ${e?.message || e}`,
          );
        }
      }

      pruneEmptyDirsUpTo(distComponents, outDir);
    },
  };
}

/* ============================================================================
 * Factory: assemble all plugins for this environment
 * ==========================================================================
 */

/**
 * Create the Vite plugin array used by Emulsify builds.
 *
 * @param {{
 *   projectDir: string,  // Absolute project root
 *   platform: string,    // e.g., 'drupal' or 'generic'
 *   srcDir: string,      // Absolute path to the preferred source dir (src or components)
 *   srcExists: boolean,  // True if `src/` exists
 *   legacyVariant?: boolean
 * }} env
 * @returns {import('vite').PluginOption[]} Ordered plugins for Vite
 */
export function makePlugins(env) {
  const { projectDir, platform, srcDir, srcExists, legacyVariant } = env;

  const basePlugins = [
    // Twig in dev/preview
    twig({
      framework: 'react',
      namespaces: {
        components: resolve(projectDir, './src/components'),
        layout: resolve(projectDir, './src/layout'),
        tokens: resolve(projectDir, './src/tokens'),
      },
    }),

    // Sass glob imports
    sassGlobImports(),

    // YAML support
    yml(),
  ];

  // If legacy variant is active, skip Twig/assets copying + mirroring.
  if (legacyVariant) {
    return [
      ...basePlugins,
      svgSpriteFilePlugin({
        include: [
          `${projectDir.replace(/\\/g, '/')}/assets/icons/**/*.svg`,
          'assets/icons/**/*.svg',
          'src/assets/icons/**/*.svg',
          'src/**/icons/**/*.svg',
        ],
        symbolId: 'icon-[name]',
      }),
    ];
  }

  // Modern behavior (unchanged from before).
  return [
    ...basePlugins,

    // Copy Twig & metadata
    copyTwigFilesPlugin({ srcDir }),

    // Copy all non-code assets under src/ with correct routing
    copyAllSrcAssetsPlugin({ srcDir }),

    // Emit a physical `dist/assets/icons.sprite.svg`
    svgSpriteFilePlugin({
      include: [
        `${projectDir.replace(/\\/g, '/')}/assets/icons/**/*.svg`,
        'assets/icons/**/*.svg',
        'src/assets/icons/**/*.svg',
        'src/**/icons/**/*.svg',
      ],
      symbolId: 'icon-[name]',
    }),

    // Mirror to ./components for Drupal only
    mirrorComponentsToRoot({
      enabled: srcExists && platform === 'drupal',
      projectDir,
    }),
  ];
}
