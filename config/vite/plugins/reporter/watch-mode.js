/**
 * @file Watch-invocation detection for the Emulsify develop reporter.
 *
 * The reporter and its quiet Sass logger should only take over output for the
 * long-running watcher that `npm run develop` starts. Every other command that
 * loads this Vite config — `npm run build`, `storybook build`, `storybook dev`,
 * and the release fixture verifications — must keep its current output exactly
 * as it is today.
 *
 * Vite resolves `command: 'build'` for both `vite build` and
 * `vite build --watch`, so the resolved config cannot distinguish them at the
 * point where `css.preprocessorOptions` has to be decided. The CLI flag is the
 * only signal available that early, so it is read directly. The plugin
 * independently confirms the decision against `config.build.watch` once the
 * config is resolved, which covers projects that enable watch mode through
 * their own config patch rather than the flag.
 */

/**
 * Flags that put the Vite CLI into watch mode.
 *
 * @type {string[]}
 */
const WATCH_FLAGS = ['--watch', '-w'];

/**
 * Determine whether the current process was invoked as a Vite watch build.
 *
 * @param {string[]} [argv] - Process arguments.
 * @returns {boolean} TRUE when a watch flag is present.
 */
export function isWatchInvocation(argv = process.argv) {
  if (!Array.isArray(argv)) return false;

  return argv.some(
    (arg) =>
      WATCH_FLAGS.includes(arg) ||
      WATCH_FLAGS.some((flag) => arg.startsWith(`${flag}=`)),
  );
}
