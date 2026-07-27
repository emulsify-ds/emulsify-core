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
 * Matches Rolldown's raw failure dump.
 *
 * The dump repeats every error up to three times — message, cause, and stack —
 * and appends a Dart Sass JS trace that points into `sass.dart.js` rather than
 * anywhere in the project.
 *
 * @type {RegExp}
 */
const RAW_BUILD_DUMP =
  /^\s*(?:Build failed with \d+ error|\[plugin [\w:-]+\]|Error: \[sass\]|\[sass\] )/;

/**
 * Matches a Dart Sass JS stack frame.
 *
 * These point into the compiler bundle rather than the project and are noise
 * wherever they appear, so their presence alone identifies a raw dump.
 *
 * @type {RegExp}
 */
const DART_SASS_FRAME = /\bsass\.dart\.js:\d+/;

/**
 * Determine whether the reporter should stand aside and let Vite speak.
 *
 * @param {object} [env] - Environment variables.
 * @returns {boolean} TRUE when raw output should pass through.
 */
export function isVerbose(env = process.env) {
  return Boolean(env.EMULSIFY_VERBOSE) && env.EMULSIFY_VERBOSE !== '0';
}

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
export function createReporterLogger(collector, baseLogger, { verbose } = {}) {
  const passRawThrough = verbose === undefined ? isVerbose() : verbose;

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

  /**
   * Determine whether a failure dump has already been reported in table form.
   *
   * Output is only ever dropped once the reporter holds the same information
   * in a readable shape; an error it failed to parse still reaches the user.
   *
   * @param {string} message - Raw log message.
   * @returns {boolean} TRUE when the dump is redundant.
   */
  const isRedundantDump = (message) => {
    if (passRawThrough) return false;
    if (!collector.hasCapturedBuildErrors?.()) return false;

    const plain = stripAnsi(String(message));
    return RAW_BUILD_DUMP.test(plain) || DART_SASS_FRAME.test(plain);
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

    error(message, options) {
      if (isRedundantDump(message)) return;
      baseLogger.error(message, options);
    },

    clearScreen: (type) => baseLogger.clearScreen(type),

    hasErrorLogged: (error) => baseLogger.hasErrorLogged(error),
  };
}
