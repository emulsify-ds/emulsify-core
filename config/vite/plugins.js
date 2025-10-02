/* eslint-disable */

/**
 * @file Vite plugins factory for Emulsify.
 *
 * @summary
 *  - Copies TWIG templates + component metadata from `src/` to `dist/` using
 *    the very same routing rules as your JS/CSS entries:
 *      • `src/components/**`         → `dist/components/**`
 *      • `src/!(components|util)/**` → `dist/global/**`
 *  - Copies **all non-code assets** under `src/` to the same routed locations.
 *  - Builds a **physical** SVG spritemap at `dist/assets/icons.sprite.svg`.
 *  - When `env.platform === 'drupal'` AND `env.srcExists` AND `env.SDC === true`,
 *    mirrors `dist/components/**` → `./components/**` and prunes leftovers.
 *
 * Security notes (ESLint: security/detect-*-fs-*):
 *  - All dynamic filesystem calls are funneled through small "safe FS" helpers
 *    that validate paths are inside allowed roots (projectDir and/or outDir).
 *  - Each helper contains a single, narrowly-scoped
 *    `// eslint-disable-next-line security/detect-non-literal-fs-filename`
 *    on the actual `fs.*` call, with prior path validation and normalization.
 */

import { resolve, join, dirname, basename, normalize } from 'path';
import {
  mkdirSync as _mkdirSync,
  copyFileSync as _copyFileSync,
  unlinkSync as _unlinkSync,
  readdirSync as _readdirSync,
  rmdirSync as _rmdirSync,
  statSync as _statSync,
  existsSync as _existsSync,
  readFileSync as _readFileSync,
} from 'fs';
import { globSync } from 'glob';

import yml from '@modyfi/vite-plugin-yaml';
import twig from 'vite-plugin-twig-drupal';

/* ============================================================================
 * Utilities
 * ========================================================================== */

/**
 * Normalize to POSIX-style separators (forward slashes).
 * @param {string} p
 * @returns {string}
 */
const toPosix = (p) => p.replace(/\\/g, '/');

/**
 * True when the last path segment starts with an underscore.
 * Used to skip Twig partials (e.g., `_button.twig`).
 * @param {string} filePath
 * @returns {boolean}
 */
const isPartialTwig = (filePath) =>
  (filePath.split('/')?.pop() || '').trim().startsWith('_');

/**
 * Create a small, validated FS façade that only permits reads/writes
 * inside the given `allowedRoots`.
 *
 * @param {string[]} allowedRoots - Absolute directories that are safe.
 */
function makeSafeFs(allowedRoots) {
  /** Ensure absolute, normalized roots once. */
  const roots = allowedRoots
    .filter(Boolean)
    .map((r) => normalize(resolve(r)));

  /** Check that a path is a descendant (or equal) of one of the roots. */
  const isAllowed = (candidate) => {
    const c = normalize(resolve(candidate)) + '/';
    return roots.some((root) => {
      const r = normalize(resolve(root)) + '/';
      return c.startsWith(r);
    });
  };

  return {
    /**
     * @param {string} dir
     * @returns {string[]} children or []
     */
    readdir(dir) {
      if (!isAllowed(dir)) return [];
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      try { return _readdirSync(dir); } catch { return []; }
    },

    /**
     * @param {string} p
     * @returns {import('fs').Stats|null}
     */
    stat(p) {
      if (!isAllowed(p)) return null;
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      try { return _statSync(p); } catch { return null; }
    },

    /**
     * @param {string} p
     * @returns {boolean}
     */
    exists(p) {
      if (!isAllowed(p)) return false;
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      try { return _existsSync(p); } catch { return false; }
    },

    /**
     * @param {string} p
     * @returns {string} file text or ''
     */
    readFile(p) {
      if (!isAllowed(p)) return '';
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      try { return _readFileSync(p, 'utf8'); } catch { return ''; }
    },

    /**
     * @param {string} dir
     */
    mkdir(dir) {
      if (!isAllowed(dir)) return;
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      try { _mkdirSync(dir, { recursive: true }); } catch { /* noop */ }
    },

    /**
     * @param {string} src
     * @param {string} dest
     */
    copyFile(src, dest) {
      if (!isAllowed(src) || !isAllowed(dest)) return;
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      try { _copyFileSync(src, dest); } catch { /* noop */ }
    },

    /**
     * @param {string} p
     */
    unlink(p) {
      if (!isAllowed(p)) return;
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      try { _unlinkSync(p); } catch { /* noop */ }
    },

    /**
     * @param {string} p
     */
    rmdir(p) {
      if (!isAllowed(p)) return;
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      try { _rmdirSync(p); } catch { /* noop */ }
    },
  };
}

/**
 * Remove empty parent directories up to (but not including) `stopAtDir`.
 *
 * @param {{ rmdir: (p:string)=>void, readdir: (p:string)=>string[] }} fsx - Safe FS façade.
 * @param {string} startDir - Directory where pruning begins.
 * @param {string} stopAtDir - Non-inclusive boundary directory.
 */
function pruneEmptyParents(fsx, startDir, stopAtDir) {
  const stop = normalize(resolve(stopAtDir));
  let cursor = normalize(resolve(startDir));

  const isEmpty = (dir) => {
    const items = fsx.readdir(dir);
    return Array.isArray(items) && items.length === 0;
  };

  while (cursor.startsWith(stop)) {
    if (!isEmpty(cursor)) break;
    fsx.rmdir(cursor);
    const parent = dirname(cursor);
    if (parent === cursor || parent === stop) break;
    cursor = parent;
  }
}

/**
 * Depth-first walk returning all file paths under `rootDir`.
 *
 * @param {{ readdir: (p:string)=>string[], stat: (p:string)=>import('fs').Stats|null }} fsx
 * @param {string} rootDir
 * @returns {string[]}
 */
function walkFiles(fsx, rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length) {
    const dir = stack.pop();
    if (!dir) continue;

    const names = fsx.readdir(dir);
    if (!names || !names.length) continue;

    for (const name of names) {
      const full = join(dir, name);
      const info = fsx.stat(full);
      if (!info) continue;
      if (info.isDirectory()) stack.push(full);
      else files.push(full);
    }
  }

  return files;
}

/* ============================================================================
 * Plugin: Copy Twig files (+ component metadata) using JS/CSS-like routing
 * ========================================================================== */

/**
 * Copies Twig templates and component metadata from `src/` to `dist/`,
 * respecting the same routing rules used for JS/CSS outputs.
 *
 * @param {{ srcDir: string }} opts
 * @returns {import('vite').PluginOption}
 */
function copyTwigFilesPlugin({ srcDir }) {
  let outDir = 'dist';

  return {
    name: 'emulsify-copy-twig-files',
    apply: 'build',
    enforce: 'post',

    /** Capture final outDir. */
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },

    /** Copy after bundle is written. */
    closeBundle() {
      const fsx = makeSafeFs([srcDir, outDir]);

      /* 1) Component Twig → dist/components */
      const compTwigs = globSync(toPosix(join(srcDir, 'components/**/*.twig')));
      for (const abs of compTwigs) {
        const relFromSrc = toPosix(abs).split(toPosix(srcDir) + '/')[1]; // "components/foo/foo.twig"
        const withinComponents = relFromSrc.replace(/^components\//, '');
        if (isPartialTwig(withinComponents)) continue;

        const destination = join(outDir, 'components', withinComponents);
        fsx.mkdir(dirname(destination));
        fsx.copyFile(abs, destination);
      }

      /* 2) Component metadata → dist/components */
      for (const pattern of [
        'components/**/*.component.@(yml|yaml)',
        'components/**/*.component.json',
      ]) {
        const files = globSync(toPosix(join(srcDir, pattern)));
        for (const abs of files) {
          const rel = toPosix(abs)
            .split(toPosix(srcDir) + '/')[1]
            .replace(/^components\//, '');
          const destination = join(outDir, 'components', rel);
          fsx.mkdir(dirname(destination));
          fsx.copyFile(abs, destination);
        }
      }

      /* 3) Global Twig → dist/global  (exclude components/, util/, and partials) */
      const globalTwigs = globSync(toPosix(join(srcDir, '**/*.twig')), {
        ignore: [
          toPosix(join(srcDir, 'components/**')),
          toPosix(join(srcDir, 'util/**')),
          toPosix(join(srcDir, '**/_*.twig')),
        ],
      });

      for (const abs of globalTwigs) {
        const rel = toPosix(abs).split(toPosix(srcDir) + '/')[1];
        const destination = join(outDir, 'global', rel);
        fsx.mkdir(dirname(destination));
        fsx.copyFile(abs, destination);
      }
    },
  };
}

/* ============================================================================
 * Plugin: Copy **all non-code** assets under `src/` with the same routing
 * ========================================================================== */

/**
 * Copies anything under `src/` that is **not** a code/template file into
 * either `dist/components/**` or `dist/global/**`, preserving relative paths.
 *
 * Skips:
 *  - `*.js`, `*.scss`, `*.twig`, `*.map`
 *  - `*.component.(yml|yaml|json)`
 *
 * @param {{ srcDir: string }} opts
 * @returns {import('vite').PluginOption}
 */
function copyAllSrcAssetsPlugin({ srcDir }) {
  let outDir = 'dist';

  return {
    name: 'emulsify-copy-all-src-assets',
    apply: 'build',
    enforce: 'post',

    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },

    closeBundle() {
      const fsx = makeSafeFs([srcDir, outDir]);

      /* A) Component-side assets → dist/components */
      const componentAssets = globSync(toPosix(join(srcDir, 'components/**/*')), {
        nodir: true,
        ignore: [
          toPosix(join(srcDir, 'components/**/*.js')),
          toPosix(join(srcDir, 'components/**/*.scss')),
          toPosix(join(srcDir, 'components/**/*.twig')),
          toPosix(join(srcDir, 'components/**/*.component.@(yml|yaml|json)')),
          toPosix(join(srcDir, 'components/**/*.map')),
        ],
      });

      for (const abs of componentAssets) {
        const rel = toPosix(abs)
          .split(toPosix(srcDir) + '/')[1]
          .replace(/^components\//, '');
        const destination = join(outDir, 'components', rel);
        fsx.mkdir(dirname(destination));
        fsx.copyFile(abs, destination);
      }

      /* B) Global-side assets → dist/global */
      const globalAssets = globSync(toPosix(join(srcDir, '**/*')), {
        nodir: true,
        ignore: [
          toPosix(join(srcDir, 'components/**')),
          toPosix(join(srcDir, 'util/**')),
          toPosix(join(srcDir, '**/*.js')),
          toPosix(join(srcDir, '**/*.scss')),
          toPosix(join(srcDir, '**/*.twig')),
          toPosix(join(srcDir, '**/*.component.@(yml|yaml|json)')),
          toPosix(join(srcDir, '**/*.map')),
        ],
      });

      for (const abs of globalAssets) {
        const rel = toPosix(abs).split(toPosix(srcDir) + '/')[1];
        const destination = join(outDir, 'global', rel);
        fsx.mkdir(dirname(destination));
        fsx.copyFile(abs, destination);
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
 * @param {{ include: string|string[], symbolId?: string, projectDir: string }} options
 *  - include   Glob(s) of SVG files to include in the sprite.
 *  - symbolId  Pattern for symbol IDs; `[name]` is replaced by the file stem.
 *  - projectDir Absolute project directory (for safe FS).
 *
 * @returns {import('vite').PluginOption}
 */
function svgSpriteFilePlugin({ include, symbolId = 'icon-[name]', projectDir }) {
  const toArray = (x) => (Array.isArray(x) ? x : [x]).filter(Boolean);

  let patterns = [];

  return {
    name: 'emulsify-svg-sprite-file',
    apply: 'build',

    /**
     * Record include patterns and register files for watch (useful in --watch).
     */
    buildStart() {
      patterns = toArray(include).map(toPosix);
      const files = patterns.flatMap((p) => globSync(p));
      for (const f of files) {
        try { this.addWatchFile(f); } catch { /* noop */ }
      }
    },

    /**
     * Concatenate all matched SVGs into a single <svg><symbol/></svg> file.
     */
    generateBundle() {
      const fsx = makeSafeFs([projectDir]);

      const files = patterns
        .flatMap((p) => globSync(p))
        .sort((a, b) => toPosix(a).localeCompare(toPosix(b)));

      if (!files.length) return;

      const usedIds = new Set();
      const safeId = (s) =>
        s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

      const idFor = (abs) => {
        const stem = basename(abs).replace(/\.svg$/i, '');
        let id = safeId(symbolId.replace('[name]', stem));
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

      const toSymbol = (abs) => {
        const svg = fsx.readFile(abs);
        if (!svg) return '';

        const m = svg.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
        const inner = (m ? m[2] : svg)
          .replace(/<\/*symbol[^>]*>/gi, '')
          .replace(/<\/*defs[^>]*>/gi, '')
          .trim();

        const attrs = m ? m[1] : '';
        const vb = attrs.match(/\bviewBox="([^"]+)"/i);
        const vbAttr = vb ? ` viewBox="${vb[1]}"` : '';

        return `<symbol id="${idFor(abs)}"${vbAttr}>${inner}</symbol>`;
      };

      const symbols = files.map(toSymbol).filter(Boolean);
      if (!symbols.length) return;

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
 * Plugin: Mirror `dist/components/**` → `./components/**` (Drupal + src + SDC)
 * ========================================================================== */

/**
 * Mirrors built component files to the project root’s `./components/` directory
 * when `enabled` is true (i.e., `env.platform === 'drupal'` and `src/` exists
 * and `SDC` is enabled). After copying, the originals in `dist/components/`
 * are deleted and any now-empty folders are pruned.
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

    /** Discover the final outDir chosen by Vite. */
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },

    /** Copy → delete → prune flow. */
    closeBundle() {
      if (!enabled) return;

      const fsx = makeSafeFs([projectDir, outDir]);

      const distComponents = join(outDir, 'components');
      if (!fsx.exists(distComponents)) return;

      for (const src of walkFiles(fsx, distComponents)) {
        // e.g. "components/accordion/accordion.twig"
        const relFromOutDir = src.slice(join(outDir, '').length);
        const dest = join(projectDir, relFromOutDir); // "./components/..."

        fsx.mkdir(dirname(dest));
        fsx.copyFile(src, dest);
        fsx.unlink(src);
        pruneEmptyParents(fsx, dirname(src), distComponents);
      }

      // Clean up the root `dist/components` if it's now empty.
      pruneEmptyParents(fsx, distComponents, outDir);
    },
  };
}

/**
 * Create the Vite plugin array used by Emulsify builds.
 *
 * @param {{
 *   projectDir: string,  // Absolute project root
 *   platform: string,    // e.g., 'drupal' or 'generic'
 *   srcDir: string,      // Absolute path to the preferred source dir (src or components)
 *   srcExists: boolean,  // True if `src/` exists
 *   SDC: boolean,        // Single Directory Components mode
 * }} env
 * @returns {import('vite').PluginOption[]}
 */
export function makePlugins(env) {
  const { projectDir, platform, srcDir, srcExists, SDC } = env;

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
      projectDir,
    }),

    /**
     * For Drupal projects with a `src/` folder **and** SDC enabled,
     * mirror `dist/components/**` → `./components/**`.
     */
    mirrorComponentsToRoot({
      enabled: srcExists && platform === 'drupal' && !!SDC,
      projectDir,
    }),
  ];
}
