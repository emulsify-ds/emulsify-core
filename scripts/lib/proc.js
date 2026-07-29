/**
 * @file Shared process helpers for CLI scripts.
 */

import { execFileSync, spawnSync } from 'node:child_process';

/**
 * Build a default failed-command message.
 *
 * @param {object} context - Failed command context.
 * @param {string} context.command - Command name.
 * @param {string[]} context.args - Command arguments.
 * @param {string} [context.cwd] - Working directory.
 * @param {number|null} [context.status] - Exit status.
 * @returns {string} Failure message.
 */
function defaultFailureMessage({ command, args, cwd, status }) {
  const location = cwd ? ` in ${cwd}` : '';
  return `${command} ${args.join(' ')} failed${location} with exit ${status}`;
}

/**
 * Run a child process.
 *
 * By default this uses spawnSync and returns the full result. Pass
 * `{ mode: 'exec' }` for execFileSync behavior, which returns stdout.
 *
 * @param {string} command - Command name or path.
 * @param {string[]} [args=[]] - Command arguments.
 * @param {object} [options={}] - Child process options.
 * @param {'spawn'|'exec'} [options.mode='spawn'] - Process API to use.
 * @param {boolean} [options.echoOutputOnFailure=false] - Echo captured output.
 * @param {string|Function} [options.failureMessage] - Error message override.
 * @returns {*} spawnSync result or execFileSync stdout.
 */
export function run(command, args = [], options = {}) {
  const {
    mode = 'spawn',
    echoOutputOnFailure = false,
    failureMessage,
    ...processOptions
  } = options;

  if (mode === 'exec') {
    return execFileSync(command, args, {
      encoding: 'utf8',
      ...processOptions,
    });
  }

  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...processOptions,
  });

  if (result.status !== 0) {
    if (echoOutputOnFailure) {
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
    }

    const context = {
      args,
      command,
      cwd: processOptions.cwd,
      status: result.status,
      result,
    };
    const message =
      typeof failureMessage === 'function'
        ? failureMessage(context)
        : failureMessage || defaultFailureMessage(context);

    throw new Error(message);
  }

  return result;
}
