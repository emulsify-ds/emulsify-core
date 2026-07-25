/**
 * @file Sass logger that feeds the Emulsify develop reporter.
 *
 * Dart Sass prints a fully formatted warning — message, source excerpt, caret,
 * and import chain — for every deprecation it encounters, every time it
 * encounters it. A project with a handful of legacy `$space/2` divisions in a
 * shared partial can emit several hundred lines per build, because each entry
 * that imports the partial re-triggers the same warning.
 *
 * Supplying a custom logger replaces that output entirely. Rather than calling
 * `silenceDeprecations`, which hides the warnings and the fact that they exist,
 * this logger routes each report into the shared diagnostics collector so the
 * reporter can print one deduplicated summary with a migration hint. The debt
 * stays visible; only the repetition goes away.
 *
 * @see https://sass-lang.com/documentation/js-api/interfaces/logger/
 */

import { fileURLToPath } from 'node:url';

/**
 * Commands that resolve each deprecation class, keyed by Sass deprecation ID.
 *
 * Only deprecations with a mechanical fix are listed. Anything absent falls
 * back to the Sass documentation link the reporter renders by default.
 *
 * @type {Record<string, string>}
 */
export const MIGRATION_HINTS = {
  'slash-div': 'npx sass-migrator division <paths>',
  'global-builtin': 'npx sass-migrator module <paths>',
  import: 'npx sass-migrator module <paths>',
  'color-functions': 'replace lighten()/darken() with color.adjust()',
  'color-4-api': 'replace lighten()/darken() with color.adjust()',
  'legacy-js-api': 'upgrade the Sass compiler integration',
  'mixed-decls': 'move declarations above nested rules',
};

/**
 * Convert a Sass span URL into a readable filesystem path.
 *
 * Spans carry a `URL` for on-disk stylesheets, but string URLs and custom
 * importer schemes both appear in practice, so every branch is guarded.
 *
 * @param {URL|string|undefined} url - Span URL.
 * @returns {string|undefined} Filesystem path, or undefined when unavailable.
 */
export function spanUrlToPath(url) {
  if (!url) return undefined;

  const href = typeof url === 'string' ? url : url.href;
  if (!href) return undefined;
  if (!href.startsWith('file:')) return href;

  try {
    return fileURLToPath(href);
  } catch {
    return href;
  }
}

/**
 * Read the 1-based line number from a Sass span.
 *
 * Sass reports zero-based line numbers; editors and the rest of the Emulsify
 * tooling are one-based.
 *
 * @param {{start?: {line?: number}}|undefined} span - Sass source span.
 * @returns {number|undefined} 1-based line number, when available.
 */
export function spanLineNumber(span) {
  const line = span?.start?.line;
  return typeof line === 'number' ? line + 1 : undefined;
}

/**
 * Reduce a multi-line Sass message to its first meaningful line.
 *
 * @param {string|undefined} message - Raw Sass message.
 * @returns {string|undefined} Condensed message.
 */
export function condenseMessage(message) {
  if (typeof message !== 'string') return undefined;
  const [firstLine] = message.split('\n');
  return firstLine?.trim() || undefined;
}

/**
 * Create a Sass logger that records into a diagnostics collector.
 *
 * @param {ReturnType<import('./diagnostics.js').createDiagnosticsCollector>} collector - Shared collector.
 * @param {{passthrough?: (message: string, options: object) => void}} [options] - Logger options.
 * @returns {{warn: Function, debug: Function}} Sass logger.
 */
export function createSassLogger(collector, { passthrough } = {}) {
  return {
    /**
     * Record a Sass warning instead of printing it.
     *
     * @param {string} message - Warning message.
     * @param {object} [options] - Sass warning metadata.
     * @returns {void}
     */
    warn(message, options = {}) {
      const file = spanUrlToPath(options.span?.url);
      const line = spanLineNumber(options.span);

      if (options.deprecation) {
        collector.recordDeprecation({
          id: options.deprecationType?.id,
          file,
          line,
        });
      } else {
        collector.recordWarning({
          message: condenseMessage(message),
          file,
          line,
        });
      }

      // Projects that want the original firehose back can opt in per build.
      if (typeof passthrough === 'function') {
        passthrough(message, options);
      }
    },

    /**
     * Discard Sass debug output.
     *
     * `@debug` is a authoring aid and has no place in the develop summary.
     *
     * @returns {void}
     */
    debug() {},
  };
}
