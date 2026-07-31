/**
 * @file Presentation helpers for the Emulsify develop reporter.
 *
 * `npm run develop` runs Vite and Storybook under `concurrently`, which means
 * this process writes to a pipe rather than a terminal. Two consequences shape
 * everything here:
 *
 *  1. Cursor control is unavailable. Anything that rewrites a line in place
 *     degrades into concatenated garbage — that is the cause of the
 *     `pages.scssDeprecation Warning` collisions in the default output. Every
 *     helper below produces complete, append-only lines.
 *  2. Color is auto-disabled by Node when the stream is not a TTY. Since the
 *     pipe is an implementation detail of the task runner rather than a signal
 *     that the human cannot see color, color support is resolved explicitly
 *     from the environment and applied with stream validation turned off.
 */

import { styleText } from 'node:util';

/**
 * Human-facing names for platforms whose casing is not a simple capitalization.
 *
 * @type {Record<string, string>}
 */
const PLATFORM_LABELS = {
  drupal: 'Drupal',
  wordpress: 'WordPress',
  none: 'none',
};

/**
 * Status glyphs. Deliberately ASCII-adjacent so they survive any terminal font.
 *
 * @type {Record<string, string>}
 */
export const SYMBOLS = {
  ok: '\u2713',
  error: '\u2717',
  warning: '!',
  change: '~',
};

/**
 * Decide whether ANSI color should be emitted.
 *
 * Honors the `NO_COLOR` and `FORCE_COLOR` conventions before falling back to
 * TTY detection, so piping through `concurrently` does not silently strip the
 * formatting that makes the summary scannable.
 *
 * @param {{NO_COLOR?: string, FORCE_COLOR?: string}} [env] - Environment variables.
 * @param {{isTTY?: boolean}} [stream] - Destination stream.
 * @returns {boolean} TRUE when color should be emitted.
 * @see https://no-color.org/
 */
export function supportsColor(env = process.env, stream = process.stdout) {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== '0';
  return Boolean(stream?.isTTY);
}

/**
 * Decide whether block-drawing characters will render correctly.
 *
 * The banner wordmark is built from half-block glyphs. On a terminal without a
 * UTF-8 locale those degrade into replacement characters, which looks broken
 * rather than branded, so the reporter falls back to plain text instead.
 *
 * Windows consoles are excluded unless running under Windows Terminal or the
 * VS Code integrated terminal, which are the two that handle these glyphs
 * reliably.
 *
 * @param {object} [env] - Environment variables.
 * @param {string} [platform] - Node platform identifier.
 * @returns {boolean} TRUE when block glyphs are safe to emit.
 */
export function supportsUnicode(
  env = process.env,
  platform = process.platform,
) {
  if (env.EMULSIFY_NO_UNICODE) return false;

  if (platform === 'win32') {
    return Boolean(env.WT_SESSION) || env.TERM_PROGRAM === 'vscode';
  }

  if (env.TERM === 'linux' || env.TERM === 'dumb') return false;

  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
  return /UTF-?8$/i.test(locale);
}

/**
 * Create a styling function that respects the resolved color support.
 *
 * @param {boolean} enabled - Whether color is enabled.
 * @returns {(format: string|string[], text: string) => string} Styling function.
 */
export function createStyler(enabled) {
  return (format, text) => {
    if (!enabled || !format) return text;

    try {
      return styleText(format, text, { validateStream: false });
    } catch {
      // An unrecognized format name should never break a build.
      return text;
    }
  };
}

/**
 * Render a platform identifier as a display label.
 *
 * @param {string|undefined} platform - Platform identifier.
 * @returns {string} Display label.
 */
export function platformLabel(platform) {
  if (!platform) return 'none';
  const normalized = String(platform).toLowerCase();

  return (
    PLATFORM_LABELS[normalized] ||
    normalized.charAt(0).toUpperCase() + normalized.slice(1)
  );
}

/**
 * Format a duration for display.
 *
 * @param {number} milliseconds - Elapsed milliseconds.
 * @returns {string} Formatted duration.
 */
export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '0ms';
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

/**
 * Format a byte count for display.
 *
 * Rolldown's discarded asset table reported kilobytes to two decimals per file.
 * The reporter states one total and one largest file instead, so it rounds to
 * whole kilobytes and one decimal megabyte — enough to notice a bundle doubling,
 * without implying a precision that matters at this scale.
 *
 * @param {number} bytes - Byte count.
 * @returns {string} Formatted size.
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${Math.round(kilobytes)} kB`;

  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

/**
 * Format a byte count for a column of sizes.
 *
 * {@link formatBytes} rounds hard, which is right for a one-line total but wrong
 * for a table: rounding turns 5,660 and 3,010 bytes into `6 kB` and `3 kB`, and a
 * table whose whole purpose is comparison should not round away the difference.
 * A single unit keeps the column directly comparable down its length rather than
 * making the reader convert between B, kB, and MB row to row.
 *
 * Two decimals of kilobytes is the convention Rolldown's discarded asset table
 * used, so the numbers are recognizable to anyone who has read that output.
 *
 * @param {number} bytes - Byte count.
 * @returns {string} Formatted size in kilobytes.
 */
export function formatPreciseBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0.00 kB';
  return `${(bytes / 1024).toFixed(2)} kB`;
}

/**
 * Format a wall-clock timestamp for rebuild lines.
 *
 * @param {Date} [date] - Date to format.
 * @returns {string} `HH:MM:SS` timestamp.
 */
export function formatClockTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Shorten an absolute path for display relative to the project root.
 *
 * Paths outside the project — most often inside `node_modules` — keep only
 * their trailing segments so the line stays readable.
 *
 * @param {string|undefined} filePath - Path to shorten.
 * @param {string} [projectDir] - Project root.
 * @returns {string} Display path.
 */
export function displayPath(filePath, projectDir) {
  if (!filePath) return '<unknown>';

  const normalized = filePath.split('\\').join('/');
  const root = projectDir
    ? projectDir.split('\\').join('/').replace(/\/$/, '')
    : '';

  if (root && normalized.startsWith(`${root}/`)) {
    return normalized.slice(root.length + 1);
  }

  const segments = normalized.split('/');
  return segments.length > 3 ? segments.slice(-3).join('/') : normalized;
}

/**
 * Append a line reference to a display path when the line is known.
 *
 * @param {string|undefined} filePath - Path to render.
 * @param {number|undefined} line - 1-based line number.
 * @param {string} [projectDir] - Project root.
 * @returns {string} Path with optional line suffix.
 */
export function displayLocation(filePath, line, projectDir) {
  const base = displayPath(filePath, projectDir);
  return line == null ? base : `${base}:${line}`;
}

/**
 * Pluralize a noun against a count.
 *
 * @param {number} count - Item count.
 * @param {string} singular - Singular noun.
 * @param {string} [plural] - Explicit plural form.
 * @returns {string} Count and correctly inflected noun.
 */
export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
