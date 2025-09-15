/* eslint-disable */

/**
 * @file Vite plugins factory for Emulsify.
 * - Copies TWIGs and related component metadata into `dist/` using the same
 *   routing rules as JS/CSS (components → `dist/components/...`, everything
 *   else in `src/!(components|util)` → `dist/global/...`).
 * - If `srcExists && isDrupal`, mirrors `dist/components/**` to `./components/**`,
 *   deletes the originals, and prunes empty directories.
 */

import { resolve, join, dirname } from 'path';
import {
  mkdirSync,
  copyFileSync,
  unlinkSync,
  readdirSync,
  rmdirSync,
  statSync,
  existsSync,
} from 'fs';
import { globSync } from 'glob';

import yml from '@modyfi/vite-plugin-yaml';
import twig from 'vite-plugin-twig-drupal';
import svgSprite from 'vite-plugin-svg-sprite';

/**
 * Is the file a "partial" (filename starts with underscore)?
 * @param {string} filePath - Path to a file.
 * @returns {boolean} True if the final segment starts with `_`.
 */
const isPartialFileName = (filePath) => {
  const base = (filePath.split('/')?.pop() || '').trim();
  return base.startsWith('_');
};

/**
 * Recursively collect full file paths under a directory.
 * @param {string} rootDir - Directory to walk.
 * @returns {string[]} Flat list of files (no directories).
 */
const walkAllFiles = (rootDir) => {
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const dirsToVisit = [rootDir];

  while (dirsToVisit.length) {
    const currentDir = dirsToVisit.pop();
    if (!currentDir) continue;

    /** @type {string[]} */
    let childNames = [];
    try {
      childNames = readdirSync(currentDir);
    } catch {
      continue;
    }

    for (const childName of childNames) {
      const childPath = join(currentDir, childName);
      try {
        const stats = statSync(childPath);
        if (stats.isDirectory()) {
          dirsToVisit.push(childPath);
        } else {
          files.push(childPath);
        }
      } catch {
        // ignore unreadable entries
      }
    }
  }

  return files;
};

/**
 * Determine whether a directory is empty.
 * @param {string} dirPath - Directory path.
 * @returns {boolean} True if empty or unreadable.
 */
const isDirectoryEmpty = (dirPath) => {
  try {
    return readdirSync(dirPath).length === 0;
  } catch {
    return false;
  }
};

/**
 * Remove empty parent directories from `startDir` up to (but not including) `stopAtDir`.
 * @param {string} startDir - Directory to start pruning from.
 * @param {string} stopAtDir - Directory boundary (non-inclusive).
 */
const pruneEmptyDirectoriesUpTo = (startDir, stopAtDir) => {
  const stopPath = resolve(stopAtDir);
  let cursor = resolve(startDir);

  while (cursor.startsWith(stopPath)) {
    if (!isDirectoryEmpty(cursor)) break;

    try {
      rmdirSync(cursor);
    } catch {
      // Non-empty or permission issues; stop pruning at this level.
    }

    const parent = dirname(cursor);
    if (parent === cursor || parent === stopPath) break;
    cursor = parent;
  }
};

/**
 * Copy TWIG files (and optional component metadata) from `srcDir` to `dist/`
 * with routing that mirrors JS/CSS:
 *
 * @param {{ srcDir: string }} opts
 * @returns {import('vite').PluginOption} Vite plugin
 */
function copyTwigFilesPlugin({ srcDir }) {
  /** @type {string} */
  let resolvedOutDir = 'dist';

  return {
    name: 'emulsify-copy-twig-like',
    apply: 'build',
    enforce: 'post',

    /**
     * Capture the final outDir early and keep it in closure.
     * @param {import('vite').ResolvedConfig} cfg
     */
    configResolved(cfg) {
      resolvedOutDir = cfg.build?.outDir || 'dist';
    },

    /**
     * Do the actual copying after the bundle is written so we can safely
     * place files next to built assets.
     */
    closeBundle() {
      /* ------------------------- COMPONENT TWIGS -------------------------- */
      const componentTwigFiles = globSync(
        join(srcDir, 'components/**/*.twig').replace(/\\/g, '/'),
      );

      for (const absPath of componentTwigFiles) {
        const relFromSrc = absPath.split(srcDir + '/')[1]; // e.g. "components/accordion/accordion.twig"
        const componentRelative = relFromSrc.replace(/^components\//, ''); // e.g. "accordion/accordion.twig"
        if (isPartialFileName(componentRelative)) continue;

        const destinationPath = join(
          resolvedOutDir,
          'components',
          componentRelative,
        );

        mkdirSync(dirname(destinationPath), { recursive: true });
        try {
          copyFileSync(absPath, destinationPath);
        } catch {
          // ignore copy failures (permissions, transient issues)
        }
      }

      /* ------------- OPTIONAL: component schemas next to components ------- */
      const componentYamlFiles = globSync(
        join(srcDir, 'components/**/*.component.@(yml|yaml)').replace(/\\/g, '/'),
      );
      for (const absPath of componentYamlFiles) {
        const rel = absPath.split(srcDir + '/')[1].replace(/^components\//, '');
        const destinationPath = join(resolvedOutDir, 'components', rel);
        mkdirSync(dirname(destinationPath), { recursive: true });
        try {
          copyFileSync(absPath, destinationPath);
        } catch {}
      }

      const componentJsonFiles = globSync(
        join(srcDir, 'components/**/*.component.json').replace(/\\/g, '/'),
      );
      for (const absPath of componentJsonFiles) {
        const rel = absPath.split(srcDir + '/')[1].replace(/^components\//, '');
        const destinationPath = join(resolvedOutDir, 'components', rel);
        mkdirSync(dirname(destinationPath), { recursive: true });
        try {
          copyFileSync(absPath, destinationPath);
        } catch {}
      }

      /* --------------------------- GLOBAL TWIGS --------------------------- */
      const globalTwigFiles = globSync(
        join(srcDir, '**/*.twig').replace(/\\/g, '/'),
        {
          ignore: [
            join(srcDir, 'components/**').replace(/\\/g, '/'),
            join(srcDir, 'util/**').replace(/\\/g, '/'),
            join(srcDir, '**/_*.twig').replace(/\\/g, '/'),
          ],
        },
      );

      for (const absPath of globalTwigFiles) {
        const relFromSrc = absPath.split(srcDir + '/')[1]; // e.g. "layout/container/container.twig"

        // Current behavior: preserve the first folder under src (matches your latest config).
        const relForGlobal = relFromSrc;

        const destinationPath = join(resolvedOutDir, 'global', relForGlobal);
        mkdirSync(dirname(destinationPath), { recursive: true });
        try {
          copyFileSync(absPath, destinationPath);
        } catch {}
      }
    },
  };
}

/**
 * Mirror everything under `dist/components/**` to `./components/**` (project root),
 * then delete the originals and prune empty directories. Only runs when `enabled`.
 *
 * @param {{ enabled: boolean, projectDir: string }} opts
 * @returns {import('vite').PluginOption} Vite plugin
 */
function mirrorComponentsPlugin({ enabled, projectDir }) {
  /** @type {string} */
  let resolvedOutDir = 'dist';

  return {
    name: 'emulsify-mirror-components-to-root',
    apply: 'build',
    enforce: 'post',

    /**
     * Capture outDir once Vite has finalized it.
     * @param {import('vite').ResolvedConfig} cfg
     */
    configResolved(cfg) {
      resolvedOutDir = cfg.build?.outDir || 'dist';
    },

    /**
     * Mirror → delete from dist → prune empty dirs.
     */
    closeBundle() {
      if (!enabled) return;

      const distComponentsRoot = join(resolvedOutDir, 'components');
      if (!existsSync(distComponentsRoot)) return;

      const filesInDistComponents = walkAllFiles(distComponentsRoot);

      for (const sourcePath of filesInDistComponents) {
        // Convert "dist/..." → relative (e.g., "components/accordion/accordion.twig").
        const relativeFromOutDir = sourcePath.slice(
          (join(resolvedOutDir, '')).length,
        );

        // Final destination under the project root: "./components/...".
        const finalDestination = join(projectDir, relativeFromOutDir);

        mkdirSync(dirname(finalDestination), { recursive: true });

        try {
          copyFileSync(sourcePath, finalDestination);

          // Delete original, then prune any empty parent folders inside dist/components.
          try {
            unlinkSync(sourcePath);
            pruneEmptyDirectoriesUpTo(dirname(sourcePath), distComponentsRoot);
          } catch {
            // ignore unlink/prune failures
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `Mirror copy failed for ${relativeFromOutDir}: ${err?.message || err}`,
          );
        }
      }

      // Optionally remove `dist/components` itself if now empty.
      pruneEmptyDirectoriesUpTo(distComponentsRoot, resolvedOutDir);
    },
  };
}

/**
 * Create the Vite plugins array based on environment.
 *
 * @param {{
 *   projectDir: string,
 *   isDrupal: boolean,
 *   srcDir: string,
 *   srcExists: boolean
 * }} env - Environment object.
 * @returns {import('vite').PluginOption[]} Vite plugins array.
 */
export function makePlugins(env) {
  const { projectDir, isDrupal, srcDir, srcExists } = env;

  return [
    // Enable Twig templating in preview/dev flows (namespaces optional).
    twig({
      framework: 'react',
      namespaces: {
        components: resolve(projectDir, './src/components'),
        layout: resolve(projectDir, './src/layout'),
        tokens: resolve(projectDir, './src/tokens'),
      },
    }),

    // YAML support for tokens/configs.
    yml(),

    // Optional SVG sprite support.
    svgSprite({ include: ['assets/icons/**/*.svg'] }),

    // 1) Copy Twig and related component metadata into dist/ with correct routing.
    copyTwigFilesPlugin({ srcDir }),

    // 2) Mirror dist/components → ./components for Drupal when src/ exists.
    mirrorComponentsPlugin({ enabled: srcExists && isDrupal, projectDir }),
  ];
}
