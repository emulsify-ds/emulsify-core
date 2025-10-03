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
 * Component Structure Overrides behavior:
 *  - When `env.structureOverrides === true`, we **skip** copying Twig and assets, and also
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
 * ========================================================================== */

/** Determine whether a Twig file is a partial (filename starts with `_`). */
const isPartial = (filePath) =>
  (filePath.split('/')?.pop() || '').trim().startsWith('_');

/**
 * Depth-first walk to list **all files** (no directories) under a given root.
 * @param {string} rootDir
 * @returns {string[]}
 */
const walkFiles = (rootDir) => {
  const files = [];
  const stack = [rootDir];

  while (stack.length) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    let entryNames = [];
    try {
      entryNames = readdirSync(currentDir);
    } catch {
      continue; // unreadable directory
    }

    for (const name of entryNames) {
      const fullPath = join(currentDir, name);
      try {
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
 * Remove empty parent directories from a start directory **up to (but not including)**
 * a stopping boundary directory.
 * @param {string} startDir
 * @param {string} stopAtDir
 */
const pruneEmptyDirsUpTo = (startDir, stopAtDir) => {
  const stopAbs = resolve(stopAtDir);
  let cursor = resolve(startDir);

  const isEmpty = (dir) => {
    try {
      return readdirSync(dir).length === 0;
    } catch {
      return false;
    }
  };

  while (cursor.startsWith(stopAbs)) {
    if (!isEmpty(cursor)) break;

    try {
      rmdirSync(cursor);
    } catch {
      // cannot remove (in use or permissions) → stop trying here
      break;
    }

    const parent = dirname(cursor);
    if (parent === cursor || parent === stopAbs) break;
    cursor = parent;
  }
};

/* ============================================================================
 * Plugin: Copy Twig files (+ component metadata) using JS/CSS-like routing
 * ========================================================================== */

/**
 * Copy Twig templates and component metadata from `src/` to `dist/`,
 * respecting the same routing used for JS/CSS.
 *
 * @param {{ srcDir: string }} opts
 * @returns {import('vite').PluginOption}
 */
function copyTwigFilesPlugin({ srcDir }) {
  let outDir = 'dist';
  const posix = (p) => p.replace(/\\/g, '/');

  return {
    name: 'emulsify-copy-twig-files',
    apply: 'build',
    enforce: 'post',

    /** Capture the final outDir. */
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },

    /** Perform the copying after the bundle has been written. */
    closeBundle() {
      // components/**/*.twig
      const componentTwigs = globSync(
        posix(join(srcDir, 'components/**/*.twig')),
      );
      for (const absPath of componentTwigs) {
        const relFromSrc = posix(absPath).split(posix(srcDir) + '/')[1]; // "components/x/y.twig"
        const withinComponents = relFromSrc.replace(/^components\//, '');
        if (isPartial(withinComponents)) continue; // skip `_*.twig`
        const destPath = join(outDir, 'components', withinComponents);
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
          mkdirSync(dirname(destPath), { recursive: true });
          try {
            copyFileSync(absPath, destPath);
          } catch {
            /* noop */
          }
        }
      }

      // global Twig: everything under src except components/, util/, and partials
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
 * ========================================================================== */

/**
 * Copies anything in `src/` that is **not** a code/template file into
 * either `dist/components/**` or `dist/global/**`, preserving relative paths.
 *
 * Excludes: .js, .scss, .twig, source maps, and `*.component.(yml|yaml|json)`.
 *
 * @param {{ srcDir: string }} opts
 * @returns {import('vite').PluginOption}
 */
function copyAllSrcAssetsPlugin({ srcDir }) {
  let outDir = 'dist';
  const posix = (p) => p.replace(/\\/g, '/');

  return {
    name: 'emulsify-copy-all-src-assets',
    apply: 'build',
    enforce: 'post',

    /** Capture outDir. */
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },

    /** Copy component/global assets. */
    closeBundle() {
      // Component-side assets → dist/components
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
        mkdirSync(dirname(destPath), { recursive: true });
        try {
          copyFileSync(absPath, destPath);
        } catch {
          /* noop */
        }
      }

      // Global-side assets → dist/global
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
 * ========================================================================== */

/**
 * Builds a single SVG sprite file from a set of icon globs and emits it as
 * `assets/icons.sprite.svg`. Only the options you’re using are supported:
 *
 * @param {{ include: string|string[], symbolId?: string }} options
 * @returns {import('vite').PluginOption}
 */
function svgSpriteFilePlugin({ include, symbolId = 'icon-[name]' }) {
  const toArray = (x) => (Array.isArray(x) ? x : [x]).filter(Boolean);
  const posix = (p) => p.replace(/\\/g, '/');

  /** @type {string[]} */
  let patterns = [];

  return {
    name: 'emulsify-svg-sprite-file',
    apply: 'build',

    /** Register icons for watch. */
    buildStart() {
      patterns = toArray(include).map(posix);
      const files = patterns.flatMap((p) => globSync(p));
      for (const f of files) {
        try {
          this.addWatchFile(f);
        } catch {
          /* noop */
        }
      }
    },

    /** Concatenate all matched SVGs into a single sprite. */
    generateBundle() {
      const files = patterns
        .flatMap((p) => globSync(p))
        .sort((a, b) => posix(a).localeCompare(posix(b)));

      if (!files.length) return;

      const used = new Set();
      const makeId = (abs) => {
        const stem = basename(abs).replace(/\.svg$/i, '');
        let id = symbolId
          .replace('[name]', stem)
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '');
        if (!used.has(id)) {
          used.add(id);
          return id;
        }
        let i = 2;
        while (used.has(`${id}-${i}`)) i += 1;
        id = `${id}-${i}`;
        used.add(id);
        return id;
      };

      const symbols = files
        .map((abs) => {
          let content = '';
          try {
            content = readFileSync(abs, 'utf8');
          } catch {
            return '';
          }
          const m = content.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
          const inner = (m ? m[2] : content)
            .replace(/<\/*symbol[^>]*>/gi, '')
            .replace(/<\/*defs[^>]*>/gi, '')
            .trim();
          const attrs = m ? m[1] : '';
          const vb = attrs.match(/\bviewBox="([^"]+)"/i);
          const viewBoxAttr = vb ? ` viewBox="${vb[1]}"` : '';
          return `<symbol id="${makeId(abs)}"${viewBoxAttr}>${inner}</symbol>`;
        })
        .filter(Boolean);

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
 * ========================================================================== */

/**
 * Mirrors built component files to the project root’s `./components/` directory
 * when `enabled` is true (for Drupal with `src/` present). After copying, the originals
 * in `dist/components/` are deleted and any now-empty folders are pruned.
 *
 * @param {{ enabled: boolean, projectDir: string }} opts
 * @returns {import('vite').PluginOption}
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
      if (!existsSync(distComponents)) return;

      for (const srcFile of walkFiles(distComponents)) {
        const relFromOutDir = srcFile.slice(join(outDir, '').length);
        const destFile = join(projectDir, relFromOutDir);
        mkdirSync(dirname(destFile), { recursive: true });
        try {
          copyFileSync(srcFile, destFile);
          try {
            unlinkSync(srcFile);
            pruneEmptyDirsUpTo(dirname(srcFile), distComponents);
          } catch {
            /* noop */
          }
        } catch (e) {
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
 * ========================================================================== */

/**
 * Create the Vite plugin array used by Emulsify builds.
 *
 * @param {{
 *   projectDir: string,
 *   platform: string,
 *   srcDir: string,
 *   srcExists: boolean,
 *   structureOverrides?: boolean
 * }} env
 * @returns {import('vite').PluginOption[]}
 */
export function makePlugins(env) {
  const { projectDir, platform, srcDir, srcExists, structureOverrides } = env;

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

  // If component structure overrides are in play, skip copy/mirror plugins.
  if (structureOverrides) {
    return basePlugins;
  }

  return [
    ...basePlugins,

    // Copy Twig & metadata
    copyTwigFilesPlugin({ srcDir }),

    // Copy every non-code asset under src/ (fonts/images/audio/docs…) with same routing.
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

    // For Drupal projects with a `src/` folder, mirror `dist/components/**` → `./components/**`.
    mirrorComponentsToRoot({
      enabled: srcExists && platform === 'drupal',
      projectDir,
    }),
  ];
}
