/**
 * @file SVG sprite file plugin.
 *
 * Builds a physical `dist/assets/icons.svg` sprite from configured SVG globs so
 * Drupal and static consumers can reference a stable emitted spritemap asset.
 */

import { readFileSync } from 'fs';
import { basename } from 'path';
import { globSync } from 'glob';

import { toPosixPath } from '../utils/paths.js';
import { unique } from '../utils/unique.js';

/**
 * Builds a single SVG sprite file from a set of icon globs.
 *
 * @param {{ include: string|string[], symbolId?: string }} options - Plugin options.
 * @returns {import('vite').PluginOption} SVG sprite plugin.
 */
export function svgSpriteFilePlugin({ include, symbolId = '[name]' }) {
  const toArray = (x) => (Array.isArray(x) ? x : [x]).filter(Boolean);

  /** @type {string[]} */
  let patterns = [];
  /** @type {string[]} */
  let iconFiles = [];
  let iconFilesResolved = false;

  const collectIconFiles = () => {
    if (iconFilesResolved) return iconFiles;
    iconFiles = unique(
      patterns.flatMap((p) => globSync(p)).filter(Boolean),
    ).sort((a, b) => toPosixPath(a).localeCompare(toPosixPath(b)));
    iconFilesResolved = true;
    return iconFiles;
  };

  return {
    name: 'emulsify-svg-sprite-file',
    apply: 'build',

    /** Register icons for watch. */
    buildStart() {
      patterns = toArray(include).map(toPosixPath);
      iconFilesResolved = false;
      for (const f of collectIconFiles()) {
        try {
          this.addWatchFile(f);
        } catch {
          /* noop */
        }
      }
    },

    /** Concatenate all matched SVGs into a single sprite. */
    generateBundle() {
      const files = collectIconFiles();

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
            // Drop namespace-prefixed attributes that lose their prefix in the merged sprite.
            .replace(/\s+[a-zA-Z0-9_-]+:[a-zA-Z0-9_.-]+="[^"]*"/g, '')
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
        fileName: 'assets/icons.svg',
        source: sprite,
      });
    },
  };
}
