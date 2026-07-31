/**
 * @file Verbosity resolution for the Emulsify develop reporter.
 *
 * The reporter has three modes rather than two, because "show me more" and "get
 * out of the way" are different requests:
 *
 *  - `quiet` — the default. One summary per build, one line per rebuild.
 *  - `detailed` — the reporter still owns the output, but prints every input and
 *    output file with its size, and names what each rebuild actually changed.
 *  - `raw` — the reporter stands aside and restores Vite's and Rolldown's own
 *    output, including the transform progress line and the gzip table.
 *
 * `detailed` exists because `raw` answers the question badly. Rolldown writes its
 * progress line from Rust with a `\x1b[2K\r` prefix and no trailing newline, and
 * under `concurrently` that carriage return collides with Storybook's output on
 * the shared pipe. So the mode that shows the most detail is also the mode whose
 * detail is hardest to read. `detailed` keeps `logLevel` low — which is what
 * stops Rolldown instrumenting transforms at all — and renders the same facts
 * append-only, from data the plugin already holds.
 *
 * ## Why two triggers
 *
 * `npm run develop --verbose` is the form people reach for, but npm claims
 * `--verbose` as an alias for `--loglevel verbose` and never passes it to the
 * script. What it does do is export `npm_config_loglevel=verbose`, which
 * propagates through `concurrently` into the `vite` child, so the flag is
 * detectable even though it never arrives as an argument. The cost is npm's own
 * `npm verbose` chatter, which is why the environment variable is offered too.
 */

/**
 * Reporter verbosity levels.
 *
 * @type {{quiet: string, detailed: string, raw: string}}
 */
export const VERBOSITY = {
  quiet: 'quiet',
  detailed: 'detailed',
  raw: 'raw',
};

/**
 * `EMULSIFY_VERBOSE` value that selects the detailed reporter instead of raw
 * passthrough.
 *
 * @type {string}
 */
const DETAILED_VALUE = '2';

/**
 * npm log levels that mean the developer asked for more output.
 *
 * @type {string[]}
 */
const VERBOSE_NPM_LEVELS = ['verbose', 'silly'];

/**
 * Resolve the reporter's verbosity from the environment.
 *
 * `EMULSIFY_VERBOSE` wins over the npm log level, so a project whose `.npmrc`
 * raises `loglevel` permanently can still pin the reporter back down.
 *
 * Any truthy `EMULSIFY_VERBOSE` other than the detailed value keeps meaning raw
 * passthrough, which is what it has always meant.
 *
 * @param {{EMULSIFY_VERBOSE?: string, npm_config_loglevel?: string}} [env] - Environment variables.
 * @returns {string} One of {@link VERBOSITY}.
 */
export function resolveVerbosity(env = process.env) {
  const requested = env?.EMULSIFY_VERBOSE;

  // Any explicit value settles it, `0` included. Falling through to the npm log
  // level on an explicit `0` would leave a project whose `.npmrc` raises
  // `loglevel` permanently with no way to quiet the reporter back down. An empty
  // string is how a shell clears a variable, so it counts as unset.
  if (requested !== undefined && requested !== '') {
    if (requested === '0') return VERBOSITY.quiet;
    return requested === DETAILED_VALUE ? VERBOSITY.detailed : VERBOSITY.raw;
  }

  if (VERBOSE_NPM_LEVELS.includes(env?.npm_config_loglevel)) {
    return VERBOSITY.detailed;
  }

  return VERBOSITY.quiet;
}

/**
 * Determine whether the reporter should stand aside and let Vite speak.
 *
 * @param {object} [env] - Environment variables.
 * @returns {boolean} TRUE when raw output should pass through.
 */
export function isVerbose(env = process.env) {
  return resolveVerbosity(env) === VERBOSITY.raw;
}

/**
 * Determine whether the reporter should print per-file detail.
 *
 * @param {object} [env] - Environment variables.
 * @returns {boolean} TRUE when the detailed reporter is requested.
 */
export function isDetailed(env = process.env) {
  return resolveVerbosity(env) === VERBOSITY.detailed;
}

/**
 * Determine whether output the reporter replaces should be suppressed.
 *
 * True only at the default level. Both verbose modes asked for more output, so
 * neither should have anything filtered out of it.
 *
 * @param {object} [env] - Environment variables.
 * @returns {boolean} TRUE when suppression applies.
 */
export function isQuiet(env = process.env) {
  return resolveVerbosity(env) === VERBOSITY.quiet;
}
