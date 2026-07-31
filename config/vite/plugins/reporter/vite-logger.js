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

import { isQuiet, isVerbose } from './verbosity.js';

// Re-exported because the Vite config and the reporter both branch on it, and
// this module was where it lived before verbosity grew a third level.
export { isVerbose };

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
 * Detect a message that is nothing but JavaScript stack frames.
 *
 * Rolldown emits the trailing stack of a failure as its own log call. Those
 * frames point into `lightningcss`, `vite`, or `sass` internals rather than
 * anywhere in the project, so a message made only of them carries nothing once
 * the failure itself has been reported.
 *
 * @param {string} message - Plain-text log message.
 * @returns {boolean} TRUE when every line is a stack frame.
 */
function isBareStackTrace(message) {
  const lines = message.split('\n').filter((line) => line.trim());

  return lines.length > 0 && lines.every((line) => /^\s*at\s+\S/.test(line));
}

/**
 * Matches Vite's HMR notice.
 *
 * Emitted by the dev server as `hmr update <files>` through `logger.info`.
 *
 * @type {RegExp}
 */
const HMR_UPDATE_PATTERN = /(^|\s)hmr update\s/;

/**
 * Wrap the Storybook dev server's logger to drop HMR notices.
 *
 * These come from Storybook's Vite dev server, not from the watch build, and
 * there are a lot of them. The watch build rewrites every file in `dist/` on
 * every cycle — Rollup regenerates the whole bundle — and Storybook imports its
 * compiled CSS from `dist/`, so one saved stylesheet lands as several HMR events.
 * Most name Storybook's own virtual modules:
 *
 *   │  Vite hmr update
 *   │  /@id/__x00__virtual:/@storybook/builder-vite/project-annotations.js,
 *   │  /@id/__x00__virtual:/@storybook/builder-vite/vite-app.js
 *
 * Nothing there is actionable, and the reporter has already printed the rebuild
 * line that says the same thing more precisely. Under `concurrently` both
 * processes share one pipe, so these interleave with the build's output and are
 * the last thing making one command look like two.
 *
 * The wrapper delegates to whatever logger is already configured rather than
 * replacing it, so Storybook keeps its own prefixes and styling for every other
 * message. Verbose modes pass everything through, because someone who asked for
 * more output should not have this filtered away.
 *
 * @param {{
 *   baseLogger: import('vite').Logger,
 *   verbose?: boolean
 * }} options - Logger options.
 * @returns {import('vite').Logger} Wrapped logger.
 */
export function createDevServerLogger({ baseLogger, verbose } = {}) {
  const passThrough = verbose === undefined ? !isQuiet() : verbose;

  return {
    get hasWarned() {
      return baseLogger.hasWarned;
    },

    set hasWarned(value) {
      baseLogger.hasWarned = value;
    },

    info(message, options) {
      if (!passThrough && HMR_UPDATE_PATTERN.test(stripAnsi(String(message)))) {
        return;
      }
      baseLogger.info(message, options);
    },

    warn: (message, options) => baseLogger.warn(message, options),
    warnOnce: (message, options) => baseLogger.warnOnce(message, options),
    error: (message, options) => baseLogger.error(message, options),
    clearScreen: (type) => baseLogger.clearScreen(type),
    hasErrorLogged: (error) => baseLogger.hasErrorLogged(error),
  };
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

    return (
      RAW_BUILD_DUMP.test(plain) ||
      DART_SASS_FRAME.test(plain) ||
      isBareStackTrace(plain)
    );
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
