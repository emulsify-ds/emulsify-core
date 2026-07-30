/**
 * @file Route Storybook's startup announcement through the Emulsify reporter.
 *
 * `npm run develop` runs Vite and Storybook side by side under `concurrently`.
 * Once the reporter quiets Vite and Rolldown, Storybook's rounded box is the
 * only remaining block drawn in another tool's visual language, which makes one
 * command look like two.
 *
 * ## Why interception rather than `--quiet`
 *
 * Storybook has a switch for this: `outputStartupInformation()` is called behind
 * `options.quiet ||`, so `storybook dev --quiet` removes the box outright. It was
 * not used, for two reasons.
 *
 * The first is distribution. The `storybook` script lives in each consuming
 * project's `package.json`, so `--quiet` would make a cosmetic improvement
 * depend on every consumer editing a script — and a project that did not would
 * get no improvement at all. Interception ships with the package.
 *
 * The second is that the box carries information nothing else does. Consumers
 * run `storybook dev --ci`, and `--ci` makes Storybook fall forward to the next
 * free port without prompting. The resolved port only appears in the box. A
 * developer whose previous session is still holding 6006 would otherwise open
 * the requested port and see a stale instance, with nothing anywhere saying so.
 * Parsing the box is what makes {@link renderReady}'s port drift warning
 * possible.
 *
 * ## Failure behavior
 *
 * Everything here is best-effort. `storybook/internal/node-logger` is an
 * internal subpath and the box payload is a formatted string, so both can change
 * between Storybook releases. Every failure path leaves Storybook's own logger
 * untouched, which means the worst outcome is the box that prints today.
 */

import {
  createStyler,
  supportsColor,
  supportsUnicode,
} from '../config/vite/plugins/reporter/format.js';
import { renderReady } from '../config/vite/plugins/reporter/render.js';

/**
 * Matches the URL rows inside Storybook's startup box.
 *
 * The box lists `- Local:`, `- On your network:`, and optionally
 * `- Other allowed hosts:`, each followed by whitespace and a URL. Matching the
 * label rather than the position keeps the parse working if a row is added or
 * reordered.
 *
 * @type {RegExp}
 */
const URL_ROW_PATTERN = /^\s*-\s*(Local|On your network):\s*(\S+)/gim;

/**
 * Identifies the startup box among every other boxed message Storybook draws.
 *
 * @type {RegExp}
 */
const READY_PATTERN = /Storybook\s+ready/i;

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
 * Extract the local and network URLs from a startup box payload.
 *
 * @param {string} message - Box contents.
 * @returns {{local?: string, network?: string}} Parsed URLs.
 */
export function parseReadyUrls(message) {
  const urls = {};
  if (typeof message !== 'string') return urls;

  const plain = stripAnsi(message);
  URL_ROW_PATTERN.lastIndex = 0;

  let match = URL_ROW_PATTERN.exec(plain);
  while (match) {
    const [, label, url] = match;
    urls[label.toLowerCase() === 'local' ? 'local' : 'network'] = url;
    match = URL_ROW_PATTERN.exec(plain);
  }

  return urls;
}

/**
 * Read the port out of a URL.
 *
 * @param {string|undefined} url - URL to inspect.
 * @returns {string|undefined} Port, when present.
 */
export function portFromUrl(url) {
  if (!url) return undefined;

  try {
    const { port } = new URL(url);
    return port || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Determine whether a boxed message is Storybook's startup announcement.
 *
 * @param {string} message - Box contents.
 * @returns {boolean} TRUE when the message is the ready box.
 */
export function isReadyBox(message) {
  return typeof message === 'string' && READY_PATTERN.test(stripAnsi(message));
}

/**
 * Replace Storybook's startup box with the Emulsify ready panel.
 *
 * Only the ready box is intercepted. Every other boxed message — and there are
 * several, including migration notices and error summaries — passes through to
 * Storybook untouched, because this exists to unify one visual element rather
 * than to take over Storybook's output.
 *
 * @param {{
 *   logger?: {logBox?: Function, log?: Function},
 *   requestedPort?: string|number,
 *   write?: (line: string) => void,
 *   colorEnabled?: boolean,
 *   unicodeEnabled?: boolean
 * }} [options] - Interception options.
 * @returns {boolean} TRUE when the logger was wrapped.
 */
export function interceptReadyBox({
  logger,
  requestedPort,
  write = (line) => process.stdout.write(`${line}\n`),
  colorEnabled,
  unicodeEnabled,
} = {}) {
  if (typeof logger?.logBox !== 'function') return false;

  const styler = createStyler(
    colorEnabled === undefined ? supportsColor() : colorEnabled,
  );
  const unicode =
    unicodeEnabled === undefined ? supportsUnicode() : unicodeEnabled;

  const originalLogBox = logger.logBox.bind(logger);

  logger.logBox = (message, boxOptions) => {
    if (!isReadyBox(message)) return originalLogBox(message, boxOptions);

    try {
      const urls = parseReadyUrls(message);
      const actual = portFromUrl(urls.local);

      const lines = renderReady({
        service: 'storybook',
        urls,
        portDrift:
          requestedPort && actual
            ? { requested: requestedPort, actual }
            : undefined,
        unicode,
        styler,
      });

      lines.forEach((line) => write(line));
      return undefined;
    } catch {
      // A parse failure must not cost the developer the URLs they need.
      return originalLogBox(message, boxOptions);
    }
  };

  return true;
}

/**
 * Install the interception against Storybook's real node logger.
 *
 * Called for its side effect during preset evaluation, which happens well before
 * the server announces itself.
 *
 * @param {{requestedPort?: string|number}} [options] - Interception options.
 * @returns {Promise<boolean>} TRUE when interception was installed.
 */
export async function installReadyReporter({ requestedPort } = {}) {
  try {
    const { logger } = await import('storybook/internal/node-logger');
    return interceptReadyBox({ logger, requestedPort });
  } catch {
    // Storybook changed the subpath or the export. Its own box still prints.
    return false;
  }
}

/**
 * Read the port requested on the command line.
 *
 * Storybook resolves `-p` / `--port` itself, but by the time the box is drawn the
 * value has been replaced by whatever port was actually free. The request has to
 * be captured from argv to have anything to compare against.
 *
 * @param {string[]} [argv] - Process arguments.
 * @returns {string|undefined} Requested port.
 */
export function requestedPortFromArgv(argv = process.argv) {
  if (!Array.isArray(argv)) return undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '-p' || arg === '--port') {
      const value = argv[index + 1];
      return value && /^\d+$/.test(value) ? value : undefined;
    }

    const inline = /^--port=(\d+)$/.exec(arg);
    if (inline) return inline[1];
  }

  return undefined;
}
