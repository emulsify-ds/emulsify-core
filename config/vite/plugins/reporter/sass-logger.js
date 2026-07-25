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
 * What each Sass deprecation means and how to resolve it.
 *
 * `fix` is the substitution to make, written as `before → after` so the row
 * reads as an instruction rather than an identifier. A deprecation ID like
 * `slash-div` tells a themer nothing on its own; `$a/$b → math.div($a, $b)`
 * tells them exactly what to type.
 *
 * `migrator` names the `sass-migrator` migration that rewrites the code
 * automatically, and is omitted for deprecations that have to be fixed by hand.
 * The migrator only ships five migrations, so most IDs here have no entry.
 *
 * @type {Record<string, {fix: string, migrator?: string}>}
 * @see https://sass-lang.com/documentation/cli/migrator/
 */
export const DEPRECATION_GUIDE = {
  'slash-div': {
    fix: '$a/$b → math.div($a, $b)',
    migrator: 'division',
  },
  'global-builtin': {
    fix: 'map-get() → map.get()',
    migrator: 'module',
  },
  import: {
    fix: '@import → @use',
    migrator: 'module',
  },
  'color-functions': {
    fix: 'lighten()/darken() → color.adjust()',
    migrator: 'color',
  },
  'if-function': {
    fix: 'if() → CSS if()',
    migrator: 'if',
  },
  'color-4-api': { fix: 'color.red($c) → color.channel($c, "red")' },
  'legacy-js-api': { fix: 'render() → compile()' },
  'mixed-decls': { fix: 'move declarations above nested rules' },
  'strict-unary': { fix: '$a -$b → $a - $b' },
  'abs-percent': { fix: 'abs(10%) → math.abs(10%)' },
  'duplicate-var-flags': { fix: 'remove the repeated !default or !global' },
  'null-alpha': { fix: 'rgb($c, null) → rgb($c)' },
  'feature-exists': { fix: 'remove meta.feature-exists()' },
  'moz-document': { fix: 'remove @-moz-document' },
  'bogus-combinators': { fix: 'remove the dangling combinator' },
  elseif: { fix: '@elseif → @else if' },
  'call-string': { fix: 'call($name) → call(get-function($name))' },
  'new-global': { fix: 'declare the variable before assigning it !global' },
};

/**
 * Look up the human-readable fix for a deprecation ID.
 *
 * @param {string} id - Sass deprecation ID.
 * @returns {string|undefined} Fix instruction, when one is known.
 */
export function deprecationFix(id) {
  return DEPRECATION_GUIDE[id]?.fix;
}

/**
 * Look up the `sass-migrator` migration that resolves a deprecation ID.
 *
 * @param {string} id - Sass deprecation ID.
 * @returns {string|undefined} Migration name, when one exists.
 */
export function deprecationMigrator(id) {
  return DEPRECATION_GUIDE[id]?.migrator;
}

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
 * Detect Dart Sass's own truncation notice.
 *
 * Without `verbose`, Sass prints at most five instances of each deprecation and
 * then emits `"N repetitive deprecation warnings omitted."` as a warning with no
 * span attached. That notice is not a problem in the stylesheet — it is Sass
 * reporting that it hid some. Recording it would put a locationless row in the
 * summary and, worse, imply the reporter's totals are complete when they are
 * short by exactly the number Sass suppressed.
 *
 * {@link createSassOptions} sets `verbose` so the notice should never appear,
 * but a project that overrides `preprocessorOptions` could reintroduce it.
 *
 * @param {string|undefined} message - Raw Sass message.
 * @returns {boolean} TRUE when the message is a truncation notice.
 */
export function isRepetitionNotice(message) {
  if (typeof message !== 'string') return false;
  return /^\s*\d+\s+repetitive\s+deprecation\s+warnings?\s+omitted\b/i.test(
    message,
  );
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
      // Sass counting its own suppressed warnings is not a finding to report.
      if (isRepetitionNotice(message)) return;

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

/**
 * Build the Sass preprocessor options used by the develop watcher.
 *
 * `verbose` and the custom logger have to travel together. Dart Sass caps each
 * deprecation at five reported instances by default, so a reporter that counts
 * what the logger receives would silently undercount — a project with 135 real
 * occurrences would be told it had 85. Turning `verbose` on hands every
 * occurrence to the logger, which then deduplicates them properly. The console
 * stays quiet either way, because the logger prints nothing.
 *
 * @param {ReturnType<import('./diagnostics.js').createDiagnosticsCollector>} collector - Shared collector.
 * @param {{passthrough?: (message: string, options: object) => void}} [options] - Logger options.
 * @returns {{logger: {warn: Function, debug: Function}, verbose: boolean}} Sass options.
 */
export function createSassOptions(collector, options = {}) {
  return {
    logger: createSassLogger(collector, options),
    verbose: true,
  };
}
