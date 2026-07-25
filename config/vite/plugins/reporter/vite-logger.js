/**
 * @file Vite logger wrapper for the Emulsify develop reporter.
 *
 * Sass warnings reach the reporter through a Sass logger, but Vite emits its
 * own diagnostics through `config.logger`. The most common of those in an
 * Emulsify project is the unresolved CSS asset notice:
 *
 *   ../images/bg-lines.png referenced in ../images/bg-lines.png didn't resolve
 *   at build time, it will remain unchanged to be resolved at runtime
 *
 * Vite emits one per `url()` it cannot resolve, mid-build, so they land
 * interleaved with transform progress and Storybook's startup. The wording is
 * also unhelpful: the "referenced in" file is frequently identical to the URL
 * itself, and nothing in the sentence says whether this is a problem.
 *
 * This wrapper intercepts those and routes them into the shared diagnostics
 * collector so they surface once, grouped, in the build summary. Every other
 * message passes straight through to Vite's own logger untouched.
 */

/**
 * Matches Vite's unresolved CSS asset notice.
 *
 * @type {RegExp}
 * @see https://github.com/vitejs/vite - `vite:css` url replacer
 */
const UNRESOLVED_ASSET_PATTERN =
  /^(.+?) referenced in (.+?) didn't resolve at build time/;

/**
 * Remove ANSI escape sequences so pattern matching sees plain text.
 *
 * @param {string} value - Possibly styled text.
 * @returns {string} Plain text.
 */
const stripAnsi = (value) =>
  // eslint-disable-next-line no-control-regex
  String(value).replace(/\[[0-9;]*m/g, '');

/**
 * Parse Vite's unresolved CSS asset notice.
 *
 * @param {string} message - Raw log message.
 * @returns {{url: string, importer: string|undefined}|undefined} Parsed notice.
 */
export function parseUnresolvedAsset(message) {
  if (typeof message !== 'string') return undefined;

  const match = UNRESOLVED_ASSET_PATTERN.exec(stripAnsi(message).trim());
  if (!match) return undefined;

  const [, url, importer] = match;

  return {
    url,
    // Vite reports the URL as its own importer when the referencing stylesheet
    // is not known. Recording that adds nothing, so it is dropped.
    importer: importer === url ? undefined : importer,
  };
}

/**
 * Wrap a Vite logger so reportable diagnostics are collected instead of printed.
 *
 * The wrapper delegates rather than spreading, because `hasWarned` is a mutable
 * property that Vite reads back after logging; a spread copy would freeze it.
 *
 * @param {ReturnType<import('./diagnostics.js').createDiagnosticsCollector>} collector - Shared collector.
 * @param {import('vite').Logger} baseLogger - Logger to delegate to.
 * @returns {import('vite').Logger} Wrapped logger.
 */
export function createReporterLogger(collector, baseLogger) {
  /**
   * Record a message if it is one the reporter owns.
   *
   * @param {string} message - Raw log message.
   * @returns {boolean} TRUE when the message was captured.
   */
  const capture = (message) => {
    const unresolvedAsset = parseUnresolvedAsset(message);
    if (!unresolvedAsset) return false;

    collector.recordUnresolvedAsset(unresolvedAsset);
    return true;
  };

  return {
    get hasWarned() {
      return baseLogger.hasWarned;
    },

    set hasWarned(value) {
      baseLogger.hasWarned = value;
    },

    info: (message, options) => baseLogger.info(message, options),

    warn(message, options) {
      if (!capture(message)) baseLogger.warn(message, options);
    },

    warnOnce(message, options) {
      if (!capture(message)) baseLogger.warnOnce(message, options);
    },

    error: (message, options) => baseLogger.error(message, options),

    clearScreen: (type) => baseLogger.clearScreen(type),

    hasErrorLogged: (error) => baseLogger.hasErrorLogged(error),
  };
}
