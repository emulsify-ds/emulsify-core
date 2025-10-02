/**
 * @file Vite plugins factory for Emulsify.
 *
 * @description
 * - Copies TWIGs & component metadata into `dist/` using the same routing rules as JS/CSS:
 *     • `src/components/**`         → `dist/components/**`
 *     • `src/!(components|util)/**` → `dist/global/**`
 * - Copies **all non-code assets** found under `src/` to the same routed locations.
 * - Builds a **physical** spritemap at `dist/assets/icons.sprite.svg`.
 * - If `env.platform === 'drupal'` AND `env.srcExists` AND `env.SDC === true`,
 *   mirrors `dist/components/**` → `./components/**` and prunes leftovers.
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

/* -------------------------------- helpers ------------------------------- */

const posix = (p) => p.replace(/\\/g, '/');

/** Is a Twig partial (filename starts with `_`)? */
const isPartial = (filePath) =>
  (filePath.split('/')?.pop() || '').trim().startsWith('_');

/** Depth-first file walk (returns files only). */
const walkFiles = (rootDir) => {
  const files = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    if (!dir) continue;
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = join(dir, name);
      try {
        const st = statSync(full);
        if (st.isDirectory()) stack.push(full);
        else files.push(full);
      } catch {
        /* ignore */
      }
    }
  }
  return files;
};

/** Remove empty parent directories up to (but not including) stopAtDir. */
const pruneEmptyDirsUpTo = (startDir, stopAtDir) => {
  const stop = resolve(stopAtDir);
  let cur = resolve(startDir);
  const isEmpty = (d) => {
    try {
      return readdirSync(d).length === 0;
    } catch {
      return false;
    }
  };
  while (cur.startsWith(stop)) {
    if (!isEmpty(cur)) break;
    try {
      rmdirSync(cur);
    } catch {
      break;
    }
    const parent = dirname(cur);
    if (parent === cur || parent === stop) break;
    cur = parent;
  }
};

/* --------------------------- copy Twig & metadata -------------------------- */

/**
 * Copy Twig files & component metadata using JS/CSS-like routing.
 * @param {{ srcDir: string }} opts
 * @returns {import('vite').PluginOption}
 */
function copyTwigFilesPlugin({ srcDir }) {
  let outDir = 'dist';

  return {
    name: 'emulsify-copy-twig-files',
    apply: 'build',
    enforce: 'post',
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },
    closeBundle() {
      // components/**/*.twig → dist/components (skip partials)
      const compTwigs = globSync(posix(join(srcDir, 'components/**/*.twig')));
      for (const abs of compTwigs) {
        const relFromSrc = posix(abs).split(posix(srcDir) + '/')[1]; // "components/x/y.twig"
        const withinComponents = relFromSrc.replace(/^components\//, '');
        if (isPartial(withinComponents)) continue;

        const dest = join(outDir, 'components', withinComponents);
        mkdirSync(dirname(dest), { recursive: true });
        try {
          copyFileSync(abs, dest);
        } catch {
          // ignore copy failures (permissions, transient issues).
        }
      }

      // Component metadata alongside components
      for (const pattern of [
        'components/**/*.component.@(yml|yaml)',
        'components/**/*.component.json',
      ]) {
        const files = globSync(posix(join(srcDir, pattern)));
        for (const abs of files) {
          const rel = posix(abs)
            .split(posix(srcDir) + '/')[1]
            .replace(/^components\//, '');
          const dest = join(outDir, 'components', rel);
          mkdirSync(dirname(dest), { recursive: true });
          try {
            copyFileSync(abs, dest);
          } catch {
            // ignore copy failures (permissions, transient issues).
          }
        }
      }

      // Global *.twig (exclude components/, util/, and partials)
      const globalTwigs = globSync(posix(join(srcDir, '**/*.twig')), {
        ignore: [
          posix(join(srcDir, 'components/**')),
          posix(join(srcDir, 'util/**')),
          posix(join(srcDir, '**/_*.twig')),
        ],
      });

      for (const abs of globalTwigs) {
        const rel = posix(abs).split(posix(srcDir) + '/')[1];
        const dest = join(outDir, 'global', rel);
        mkdirSync(dirname(dest), { recursive: true });
        try {
          copyFileSync(abs, dest);
        } catch {
          // ignore copy failures (permissions, transient issues).
        }
      }
    },
  };
}

/* ------------------------ copy ALL non-code src assets --------------------- */

/**
 * Copy anything under `src/` that is **not** a code/template/map/schema file into
 * `dist/components/**` or `dist/global/**` preserving relative subpaths.
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
      // Component-side assets
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
      for (const abs of componentAssets) {
        const rel = posix(abs)
          .split(posix(srcDir) + '/')[1]
          .replace(/^components\//, '');
        const dest = join(outDir, 'components', rel);
        mkdirSync(dirname(dest), { recursive: true });
        try {
          copyFileSync(abs, dest);
        } catch {
          // ignore copy failures (permissions, transient issues).
        }
      }

      // Global-side assets (everything under src/ except components/ and util/)
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
      for (const abs of globalAssets) {
        const rel = posix(abs).split(posix(srcDir) + '/')[1];
        const dest = join(outDir, 'global', rel);
        mkdirSync(dirname(dest), { recursive: true });
        try {
          copyFileSync(abs, dest);
        } catch {
          // ignore copy failures (permissions, transient issues).
        }
      }
    },
  };
}

/* ------------------------- physical SVG spritemap -------------------------- */

/**
 * Emit a **physical** `dist/assets/icons.sprite.svg` built from icon globs.
 * @param {{ include: string|string[], symbolId?: string }} options
 *  - include: glob(s) of SVG files
 *  - symbolId: pattern for symbol IDs; `[name]` → file stem
 * @returns {import('vite').PluginOption}
 */
function svgSpriteFilePlugin({ include, symbolId = 'icon-[name]' }) {
  const toArr = (x) => (Array.isArray(x) ? x : [x]).filter(Boolean);

  let patterns = [];

  return {
    name: 'emulsify-svg-sprite-file',
    apply: 'build',

    buildStart() {
      patterns = toArr(include).map(posix);
      const files = patterns.flatMap((p) => globSync(p));
      for (const f of files) {
        try {
          this.addWatchFile(f);
        } catch {
          // ignore copy failures (permissions, transient issues).
        }
      }
    },

    generateBundle() {
      const files = patterns
        .flatMap((p) => globSync(p))
        .sort((a, b) => posix(a).localeCompare(posix(b)));

      if (!files.length) return;

      const used = new Set();
      const sanitizeId = (s) =>
        s
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '');
      const idFor = (abs) => {
        const stem = basename(abs).replace(/\.svg$/i, '');
        let id = sanitizeId(symbolId.replace('[name]', stem));
        if (used.has(id)) {
          let i = 2;
          while (used.has(`${id}-${i}`)) i += 1;
          id = `${id}-${i}`;
        }
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
          const vbMatch = attrs.match(/\bviewBox="([^"]+)"/i);
          const viewBoxAttr = vbMatch ? ` viewBox="${vbMatch[1]}"` : '';
          return `<symbol id="${idFor(abs)}"${viewBoxAttr}>${inner}</symbol>`;
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

/* ---------------- Mirror dist/components -> ./components (Drupal+SDC) ------ */

/**
 * Mirror `dist/components/**` to project `./components/**` when enabled,
 * then delete originals and prune empty directories.
 * Enabled condition should be: platform === 'drupal' && srcExists && SDC === true.
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

      for (const src of walkFiles(distComponents)) {
        const rel = src.slice(join(outDir, '').length); // "components/.."
        const dest = join(projectDir, rel); // "./components/.."
        mkdirSync(dirname(dest), { recursive: true });
        try {
          copyFileSync(src, dest);
          try {
            unlinkSync(src);
            pruneEmptyDirsUpTo(dirname(src), distComponents);
          } catch {
            console.warn(
              `Unable to unlink and clean dist directory: ${e?.message || e}`,
            );
          }
        } catch (e) {
          console.warn(`Mirror copy failed for ${rel}: ${e?.message || e}`);
        }
      }
      pruneEmptyDirsUpTo(distComponents, outDir);
    },
  };
}

/* ------------------------------ factory export ----------------------------- */

/**
 * Create the Vite plugin array used by Emulsify builds.
 * @param {{
 *   projectDir: string,
 *   platform: string,
 *   srcDir: string,
 *   srcExists: boolean,
 *   SDC: boolean
 * }} env
 * @returns {import('vite').PluginOption[]}
 */
export function makePlugins(env) {
  const { projectDir, platform, srcDir, srcExists, SDC } = env;

  return [
    // Twig for dev/preview (namespaces map to **source**)
    twig({
      framework: 'react',
      namespaces: {
        components: resolve(projectDir, './src/components'),
        layout: resolve(projectDir, './src/layout'),
        tokens: resolve(projectDir, './src/tokens'),
      },
    }),

    // YAML support
    yml(),

    // Copy Twig + metadata
    copyTwigFilesPlugin({ srcDir }),

    // Copy all non-code assets
    copyAllSrcAssetsPlugin({ srcDir }),

    // Physical SVG spritemap
    svgSpriteFilePlugin({
      include: [
        `${projectDir.replace(/\\/g, '/')}/assets/icons/**/*.svg`,
        'assets/icons/**/*.svg',
        'src/assets/icons/**/*.svg',
        'src/**/icons/**/*.svg',
      ],
      symbolId: 'icon-[name]',
    }),

    // Mirror to ./components ONLY for Drupal + srcExists + SDC
    mirrorComponentsToRoot({
      enabled: srcExists && platform === 'drupal' && !!SDC,
      projectDir,
    }),
  ];
}
