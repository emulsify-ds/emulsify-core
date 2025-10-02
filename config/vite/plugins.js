/**
 * @file Vite plugins factory for Emulsify.
 *
 * @description
 *  - Copies TWIGs/metadata into `dist/` using the same routing rules as JS/CSS:
 *      • `src/components/**`         → `dist/components/**`
 *      • `src/!(components|util)/**` → `dist/global/**`
 *  - Copies **all non-code assets** found under `src/` to the same routed locations
 *    (images, icons, audio/video, fonts, docs, etc.).
 *  - Builds a **physical** spritemap at `dist/assets/icons.sprite.svg` from icon globs.
 *  - If `env.platform === 'drupal'` and a `src/` dir exists, mirrors `dist/components/**`
 *    to `./components/**` and prunes any empty folders left behind.
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

import yml from '@modyfi/vite-plugin-yaml';
import twig from 'vite-plugin-twig-drupal';

/* ============================================================================
 * Small, focused helpers
 * ==========================================================================
 */

/**
 * Returns true when a Twig file is a partial (filename starts with `_`).
 * Example: `_button.twig` → true, `button.twig` → false
 *
 * @param {string} filePath - Path to a Twig file.
 * @returns {boolean}
 */
const isPartial = (filePath) =>
  (filePath.split('/')?.pop() || '').trim().startsWith('_');

/**
 * Depth-first walk to list **all files** (no directories) under a given root.
 *
 * @param {string} rootDir - Directory to crawl.
 * @returns {string[]} Absolute paths to files.
 */
const walkFiles = (rootDir) => {
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const stack = [rootDir];

  while (stack.length) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    /** @type {string[]} */
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
 * Removes empty parent directories from a start directory **up to (but not including)**
 * a stopping boundary directory.
 *
 * @param {string} startDir - Directory where pruning should begin.
 * @param {string} stopAtDir - Boundary directory (non-inclusive).
 */
const pruneEmptyDirsUpTo = (startDir, stopAtDir) => {
  const stopAbs = resolve(stopAtDir);
  let cursor = resolve(startDir);

  /**
   * Is the directory empty? Returns false on IO errors (treat as not empty).
   * @param {string} dir
   * @returns {boolean}
   */
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
      // Cannot remove (in use or permissions) → stop trying here.
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

/**
 * Copies Twig templates and component metadata from `src/` to `dist/`,
 * respecting the same routing rules used for JS/CSS:
 *
 * - Component Twig:
 *   `src/components/**` → `dist/components/**`
 *   (partials `_*.twig` are skipped)
 *
 * - Global Twig:
 *   `src/!(components|util)/**` → `dist/global/**`
 *
 * - Component metadata:
 *   `*.component.(yml|yaml|json)` next to components → same path in `dist/components/**`
 *
 * @param {{ srcDir: string }} opts - Options.
 * @returns {import('vite').PluginOption}
 */
function copyTwigFilesPlugin({ srcDir }) {
  /** @type {string} */
  let outDir = 'dist';
  /** @param {string} p */
  const posix = (p) => p.replace(/\\/g, '/');

  return {
    name: 'emulsify-copy-twig-files',
    apply: 'build',
    enforce: 'post',

    /**
     * Capture the resolved outDir.
     * @param {import('vite').ResolvedConfig} cfg
     */
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },

    /**
     * Perform copy work **after** Vite writes outputs so we can place files
     * next to compiled assets safely.
     */
    closeBundle() {
      /* 1) Component Twig → dist/components */
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

      /* 2) Component metadata → dist/components */
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

      /* 3) Global Twig → dist/global  (exclude components/, util/, and partials) */
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
 * ==========================================================================
 */

/**
 * Copies anything under `src/` that is **not** a code/template file into
 * either `dist/components/**` or `dist/global/**`, preserving relative paths.
 *
 * Excluded patterns:
 * - Code: `*.js`, `*.scss`, `*.twig`, `*.map`
 * - Component schemas: `*.component.(yml|yaml|json)`
 *
 * @param {{ srcDir: string }} opts - Options.
 * @returns {import('vite').PluginOption}
 */
function copyAllSrcAssetsPlugin({ srcDir }) {
  /** @type {string} */
  let outDir = 'dist';
  /** @param {string} p */
  const posix = (p) => p.replace(/\\/g, '/');

  return {
    name: 'emulsify-copy-all-src-assets',
    apply: 'build',
    enforce: 'post',

    /**
     * Capture the resolved outDir.
     * @param {import('vite').ResolvedConfig} cfg
     */
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },

    /**
     * Copy non-code assets for components and global areas.
     */
    closeBundle() {
      /* A) Component-side assets → dist/components */
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

      /* B) Global-side assets → dist/global */
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
 * ==========================================================================
 */

/**
 * Builds a single SVG sprite file from a set of icon globs and emits it as
 * `assets/icons.sprite.svg`. Only the options you’re using are supported:
 *
 * @param {{ include: string|string[], symbolId?: string }} options
 *  - include   Glob(s) of SVG files to include in the sprite.
 *  - symbolId  Pattern for symbol IDs; `[name]` is replaced by the file stem.
 *
 * @returns {import('vite').PluginOption}
 */
function svgSpriteFilePlugin({ include, symbolId = 'icon-[name]' }) {
  /** @param {string|string[]} x */
  const toArray = (x) => (Array.isArray(x) ? x : [x]).filter(Boolean);
  /** @param {string} p */
  const posix = (p) => p.replace(/\\/g, '/');

  /** @type {string[]} */
  let patterns = [];

  return {
    name: 'emulsify-svg-sprite-file',
    apply: 'build',

    /**
     * Record include patterns and register files for watch (useful in --watch).
     */
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

    /**
     * Concatenate all matched SVGs into a single <svg><symbol/></svg> file.
     */
    generateBundle() {
      const files = patterns
        .flatMap((p) => globSync(p))
        .sort((a, b) => posix(a).localeCompare(posix(b)));

      if (!files.length) return;

      const usedIds = new Set();

      /**
       * Convert file stem to a safe ID and ensure uniqueness.
       * @param {string} absPath
       * @returns {string}
       */
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

      /**
       * Extract inner content & viewBox (if available) from SVG.
       * @param {string} absPath
       * @returns {string} <symbol>…</symbol> or empty string on error
       */
      const toSymbol = (absPath) => {
        let svg = '';
        try {
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

/**
 * Mirrors built component files to the project root’s `./components/` directory
 * when `enabled` is true (i.e., `env.platform === 'drupal'` and `src/` exists).
 * After copying, the originals in `dist/components/` are deleted and any now-empty
 * folders are pruned for a clean output dir.
 *
 * @param {{ enabled: boolean, projectDir: string }} opts
 * @returns {import('vite').PluginOption}
 */
function mirrorComponentsToRoot({ enabled, projectDir }) {
  /** @type {string} */
  let outDir = 'dist';

  return {
    name: 'emulsify-mirror-components-to-root',
    apply: 'build',
    enforce: 'post',

    /**
     * Discover the final outDir chosen by Vite.
     * @param {import('vite').ResolvedConfig} cfg
     */
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },

    /**
     * Copy → delete → prune flow.
     */
    closeBundle() {
      if (!enabled) return;

      const distComponents = join(outDir, 'components');
      if (!existsSync(distComponents)) return;

      for (const srcFile of walkFiles(distComponents)) {
        // e.g. "components/accordion/accordion.twig"
        const relFromOutDir = srcFile.slice(join(outDir, '').length);
        const destFile = join(projectDir, relFromOutDir); // "./components/..."

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
          // eslint-disable-next-line no-console
          console.warn(
            `Mirror copy failed for ${relFromOutDir}: ${e?.message || e}`,
          );
        }
      }

      // Clean up the root `dist/components` if it's now empty.
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
 *   srcExists: boolean   // True if `src/` exists
 * }} env
 * @returns {import('vite').PluginOption[]} Ordered plugins for Vite
 */
export function makePlugins(env) {
  const { projectDir, platform, srcDir, srcExists } = env;

  return [
    /**
     * Twig plugin for dev/preview (Storybook/interactive dev).
     * Namespaces are additive and point at **source** locations.
     */
    twig({
      framework: 'react',
      namespaces: {
        components: resolve(projectDir, './src/components'),
        layout: resolve(projectDir, './src/layout'),
        tokens: resolve(projectDir, './src/tokens'),
      },
    }),

    /** Allow importing YAML files (tokens/config). */
    yml(),

    /** Copy Twig templates + component metadata with the same routing as CSS/JS. */
    copyTwigFilesPlugin({ srcDir }),

    /** Copy every non-code asset under src/ (fonts/images/audio/docs…) with same routing. */
    copyAllSrcAssetsPlugin({ srcDir }),

    /**
     * Build a **physical** SVG sprite (single file).
     * Note: only `include` (globs) and `symbolId` are supported here.
     */
    svgSpriteFilePlugin({
      include: [
        `${projectDir.replace(/\\/g, '/')}/assets/icons/**/*.svg`,
        'assets/icons/**/*.svg',
        'src/assets/icons/**/*.svg',
        'src/**/icons/**/*.svg',
      ],
      symbolId: 'icon-[name]',
    }),

    /**
     * For Drupal projects with a `src/` folder, mirror `dist/components/**` → `./components/**`.
     * This matches expected Drupal SDC locations at runtime.
     */
    mirrorComponentsToRoot({
      enabled: srcExists && platform === 'drupal',
      projectDir,
    }),
  ];
}
