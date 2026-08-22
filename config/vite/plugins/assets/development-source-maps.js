/**
 * @file Development source maps for Vite's extracted CSS assets.
 *
 * Vite keeps the Sass/PostCSS map through its CSS transform, then discards it
 * when `vite build` extracts the stylesheet as a Rollup asset. The capture
 * plugin runs after Vite compiles CSS but before Core rewrites asset URLs. The
 * emitter later pairs each direct stylesheet entry with its finalized CSS
 * asset, writes a sibling map, and adds the browser-facing map comment.
 *
 * Core's later URL rewrites preserve line structure. They can shift columns
 * inside a rewritten `url()`, but selector and declaration line mappings stay
 * anchored to their authored Sass sources, which is what browser style
 * inspection uses.
 */

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { safeExists } from '../../utils/fs-safe.js';
import { toPosixPath } from '../../utils/paths.js';

/** Stylesheet requests whose compiled maps can be captured. */
const STYLE_REQUEST_RE =
  /\.(?:css|p?css|sss|styl|stylus|less|sass|scss)(?:$|\?)/;

/** Query suffixes that represent asset contents rather than a stylesheet. */
const NON_STYLE_QUERY_RE = /[?&](?:raw|url)(?:&|$)/;

/** Existing external source-map annotations supplied by a project plugin. */
const SOURCE_MAP_COMMENT_RE = /\/\*[#@]\s*sourceMappingURL=[^*]+\*\//;

/** URI schemes that are not local filesystem paths. */
const URI_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;

/** Remove Vite's request query from a module id. */
const cleanId = (id) => String(id).split('?', 1)[0];

/** Clone a combined Rollup map before another transform can mutate it. */
const cloneMap = (map) => JSON.parse(JSON.stringify(map));

/**
 * Resolve one captured map source to a local file when possible.
 *
 * @param {string} source - Captured source-map source.
 * @param {string} sourceRoot - Optional captured source root.
 * @param {string} entryId - Absolute stylesheet entry id.
 * @returns {string} Absolute source path, or an empty string for virtual/remote sources.
 */
function resolveMapSource(source, sourceRoot, entryId) {
  if (!source || source.startsWith('\0')) return '';

  if (source.startsWith('file:')) {
    try {
      return fileURLToPath(source);
    } catch {
      return '';
    }
  }

  if (isAbsolute(source)) return source;
  if (URI_SCHEME_RE.test(source) || source.startsWith('//')) return '';

  let base = dirname(entryId);
  if (sourceRoot) {
    if (sourceRoot.startsWith('file:')) {
      try {
        base = fileURLToPath(sourceRoot);
      } catch {
        return '';
      }
    } else if (isAbsolute(sourceRoot)) {
      base = sourceRoot;
    } else if (URI_SCHEME_RE.test(sourceRoot) || sourceRoot.startsWith('//')) {
      return '';
    } else {
      base = resolve(base, sourceRoot);
    }
  }

  return resolve(base, source);
}

/**
 * Make captured source paths portable from the emitted map's directory.
 *
 * @param {object} captured - Captured combined source map.
 * @param {string} entryId - Absolute stylesheet entry id.
 * @param {string} mapFile - Absolute emitted map path.
 * @param {string} cssFileName - Output-relative CSS filename.
 * @returns {object} External source-map payload.
 */
function externalizeMap(captured, entryId, mapFile, cssFileName) {
  const sourceRoot = captured.sourceRoot || '';
  const preserveSourceRoot = Boolean(
    sourceRoot &&
    !sourceRoot.startsWith('file:') &&
    !isAbsolute(sourceRoot) &&
    (URI_SCHEME_RE.test(sourceRoot) || sourceRoot.startsWith('//')),
  );
  const sourceFiles = captured.sources.map((source) =>
    resolveMapSource(source, sourceRoot, entryId),
  );
  const sources = captured.sources.map((source, index) => {
    const sourceFile = sourceFiles[index];
    if (!sourceFile) return source;
    return toPosixPath(relative(dirname(mapFile), sourceFile));
  });
  const capturedContentsAreAligned =
    captured.sourcesContent?.length === captured.sources.length;
  const sourcesContent = captured.sources.map((_, index) => {
    const existing = capturedContentsAreAligned
      ? captured.sourcesContent[index]
      : null;
    if (existing != null) return existing;

    const sourceFile = sourceFiles[index];
    if (!sourceFile || !safeExists(sourceFile)) return null;

    try {
      return readFileSync(sourceFile, 'utf8');
    } catch {
      return null;
    }
  });

  const result = {
    ...captured,
    file: posix.basename(cssFileName),
    sources,
    sourcesContent,
  };
  if (!preserveSourceRoot) delete result.sourceRoot;
  return result;
}

/** Add a candidate entry id for one emitted CSS asset. */
function addCandidate(candidates, cssFileName, entryId) {
  if (!candidates.has(cssFileName)) candidates.set(cssFileName, new Set());
  candidates.get(cssFileName).add(entryId);
}

/**
 * Create the two plugins that bridge Vite's extracted-CSS source-map gap.
 *
 * The capture plugin and emitter must surround Core's CSS URL plugins in the
 * shared plugin array. They intentionally share one map cache across watch
 * rebuilds because Rollup may reuse an unchanged stylesheet's transform.
 *
 * @param {{projectDir?: string, developmentBuild?: boolean}} [opts={}] - Project paths and invocation mode.
 * @returns {{capture: import('vite').PluginOption, emit: import('vite').PluginOption}}
 */
export function developmentCssSourceMapPlugins({
  projectDir = process.cwd(),
  developmentBuild = false,
} = {}) {
  /** @type {Map<string, object>} */
  const capturedMaps = new Map();
  let outDir = resolve(projectDir, 'dist');
  let watching = Boolean(developmentBuild);
  let sourceMapsEnabled = false;

  const configResolved = (config) => {
    // The invocation signal is available before Vite resolves its config;
    // checking the resolved watch option as well supports projects that turn
    // watch mode on from an extension instead of the CLI flag.
    watching = Boolean(developmentBuild || config?.build?.watch);
    // Consumer overrides remain authoritative. Core emits visible external CSS
    // maps only for its default `true` policy, not `false`, `hidden`, or inline.
    sourceMapsEnabled = config?.build?.sourcemap === true;
    const configuredOutDir = config?.build?.outDir || 'dist';
    outDir = isAbsolute(configuredOutDir)
      ? configuredOutDir
      : resolve(projectDir, configuredOutDir);
  };

  const capture = {
    name: 'emulsify-development-css-map-capture',
    apply: 'build',
    configResolved,
    transform(_code, id) {
      if (!watching || !sourceMapsEnabled) return null;
      if (!STYLE_REQUEST_RE.test(id) || NON_STYLE_QUERY_RE.test(id)) {
        return null;
      }

      const map = this.getCombinedSourcemap();
      if (
        !map?.mappings ||
        !Array.isArray(map.sources) ||
        !map.sources.length
      ) {
        return null;
      }

      capturedMaps.set(cleanId(id), cloneMap(map));
      return null;
    },
  };

  const emit = {
    name: 'emulsify-development-css-map-emit',
    apply: 'build',
    configResolved,
    generateBundle(_options, bundle) {
      if (!watching || !sourceMapsEnabled || !capturedMaps.size) return;

      /** @type {Map<string, Set<string>>} */
      const candidates = new Map();

      // A pure CSS entry still has its facade chunk at this point. Vite removes
      // that empty JavaScript placeholder in its later CSS generateBundle hook.
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk' || !output.facadeModuleId) continue;

        const entryId = cleanId(output.facadeModuleId);
        if (!capturedMaps.has(entryId)) continue;

        for (const cssFileName of output.viteMetadata?.importedCss || []) {
          addCandidate(candidates, cssFileName, entryId);
        }
      }

      for (const [cssFileName, output] of Object.entries(bundle)) {
        if (output.type !== 'asset' || !cssFileName.endsWith('.css')) continue;
        if (typeof output.source !== 'string') continue;
        if (SOURCE_MAP_COMMENT_RE.test(output.source)) continue;

        // Metadata is a fallback for Vite-compatible emitters that omit the
        // empty facade. A map is emitted only for one unambiguous direct entry;
        // concatenated CSS from several modules is deliberately skipped.
        const entryIds = candidates.get(cssFileName) || new Set();
        if (!entryIds.size) {
          const originals = Array.isArray(output.originalFileNames)
            ? output.originalFileNames
            : output.originalFileName
              ? [output.originalFileName]
              : [];
          for (const original of originals) {
            const entryId = isAbsolute(original)
              ? cleanId(original)
              : resolve(projectDir, cleanId(original));
            if (capturedMaps.has(entryId)) entryIds.add(entryId);
          }
        }
        if (entryIds.size !== 1) continue;

        const [entryId] = entryIds;
        const mapFileName = `${cssFileName}.map`;
        if (Object.hasOwn(bundle, mapFileName)) continue;

        const mapFile = resolve(outDir, ...mapFileName.split('/'));
        const sourceMap = externalizeMap(
          capturedMaps.get(entryId),
          entryId,
          mapFile,
          cssFileName,
        );

        this.emitFile({
          type: 'asset',
          fileName: mapFileName,
          source: `${JSON.stringify(sourceMap)}\n`,
        });
        output.source = `${output.source.trimEnd()}\n/*# sourceMappingURL=${posix.basename(
          mapFileName,
        )} */\n`;
      }
    },
  };

  return { capture, emit };
}
