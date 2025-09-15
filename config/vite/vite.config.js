/* eslint-disable */

/**
 * @file Vite configuration for Emulsify.
 */

import { defineConfig } from 'vite';
import { mkdirSync, copyFileSync, unlinkSync, readdirSync, rmdirSync } from 'fs';
import { resolve as presolve, dirname, join } from 'path';

import { resolveEnvironment } from './environment.js';
import { makePlugins } from './plugins.js';
import { buildInputs, makePatterns } from './entries.js';

const env = resolveEnvironment();

function mirrorComponentsToRoot({ enabled, projectDir }) {
  const isEmptyDir = (dir) => {
    try {
      return readdirSync(dir).length === 0;
    } catch {
      return false;
    }
  };

  // Remove empty ancestors up to (but not including) stopAt
  const pruneEmptyAncestors = (startDir, stopAt) => {
    const stop = presolve(stopAt);
    let cur = presolve(startDir);
    // Guard: only prune inside stopAt subtree
    while (cur.startsWith(stop)) {
      if (!isEmptyDir(cur)) break;
      try { rmdirSync(cur); } catch {}
      const parent = dirname(cur);
      if (parent === cur || parent === stop) break;
      cur = parent;
    }
  };

  return {
    name: 'mirror-components-to-root',
    apply: 'build',
    enforce: 'post',
    writeBundle(options, bundle) {
      if (!enabled) return;
      const outDir = options.dir || 'dist';
      const distComponentsRoot = join(outDir, 'components');

      for (const fileName of Object.keys(bundle)) {
        if (!fileName.startsWith('components/')) continue;

        const src = join(outDir, fileName);           // dist/components/...
        const dest = join(projectDir, fileName);      // ./components/...

        mkdirSync(dirname(dest), { recursive: true });
        try {
          copyFileSync(src, dest);
          try {
            unlinkSync(src);                          // remove file in dist
            pruneEmptyAncestors(dirname(src), distComponentsRoot);
          } catch {}
        } catch (e) {
          this.warn(`Mirror copy failed for ${fileName}: ${e.message}`);
        }
      }

      pruneEmptyAncestors(distComponentsRoot, join(outDir));
    },
  };
}

// Build input map using the extracted module (keeps this file small & readable).
const patterns = makePatterns({
  projectDir: env.projectDir,
  srcDir: env.srcDir,
  srcExists: env.srcExists,
  isDrupal: env.isDrupal,
  SDC: env.SDC,
});

const entries = buildInputs(
  {
    projectDir: env.projectDir,
    srcDir: env.srcDir,
    srcExists: env.srcExists,
    isDrupal: env.isDrupal,
    SDC: env.SDC,
  },
  patterns,
);

export default defineConfig({
  root: process.cwd(),
  plugins: [
    ...makePlugins(env),
    mirrorComponentsToRoot({
      enabled: env.srcExists && env.isDrupal,     // only mirror for Drupal+src
      projectDir: env.projectDir,
    }),
  ],
  css: { devSourcemap: true },
  build: {
    emptyOutDir: true,
    outDir: 'dist/',
    rollupOptions: {
      input: entries,
      output: {
        entryFileNames: '[name].js',
        assetFileNames: (assetInfo) => {
          const file = assetInfo.name || assetInfo.fileName || '';
          if (file.endsWith('.css')) {
            // Normalize path and drop the CSS_SUFFIX ('__style') used to avoid key collisions
            return file.replace(/__style(?=\.css$)/, '');
          }
          return 'assets/[name][extname]';
        },
      },
    },
    server: {
      watch: { usePolling: false },
    },
  },
});
