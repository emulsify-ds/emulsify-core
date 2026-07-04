/**
 * @file Shared CLI argument helpers.
 */

/**
 * Format standard command usage text.
 *
 * @param {string} usageLine - Usage line.
 * @param {string[]} optionLines - Option lines.
 * @returns {string} Usage text.
 */
export function createUsage(usageLine, optionLines) {
  return [usageLine, '', 'Options:', ...optionLines].join('\n');
}

/**
 * Determine whether a script is running as a CLI entrypoint.
 *
 * npm package bins run through symlinks, so argv[1] may be either the source
 * script filename or the published bin name.
 *
 * @param {string[]} names - Accepted script or bin basenames.
 * @param {string[]} [argv=process.argv] - Process arguments.
 * @returns {boolean} TRUE when argv[1] matches one of the names.
 */
export function isCliEntrypoint(names, argv = process.argv) {
  const entryName = argv[1]?.split(/[\\/]/).pop();
  return names.includes(entryName);
}

/**
 * Clone default option values without sharing arrays between parses.
 *
 * @param {object} defaults - Default values.
 * @returns {object} Parsed option seed.
 */
function cloneDefaults(defaults) {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  );
}

/**
 * Normalize a boolean flag configuration.
 *
 * @param {string|object} spec - Flag config.
 * @returns {{key: string, value: *}} Normalized flag config.
 */
function normalizeFlagSpec(spec) {
  if (typeof spec === 'string') {
    return { key: spec, value: true };
  }

  return {
    value: true,
    ...spec,
  };
}

/**
 * Read the next argv value for an option.
 *
 * @param {string[]} argv - CLI arguments.
 * @param {number} index - Current option index.
 * @param {object} spec - Option config.
 * @returns {string} Raw value.
 */
function readNextValue(argv, index, spec) {
  const value = argv[index + 1];

  if (
    value === undefined ||
    (value === '' && spec.rejectEmptyValue !== false) ||
    (spec.rejectOptionLikeValue !== false && value.startsWith('--'))
  ) {
    throw new Error(spec.missingMessage);
  }

  return value;
}

/**
 * Parse and assign one option value.
 *
 * @param {object} parsed - Parsed options.
 * @param {object} spec - Option config.
 * @param {string} value - Raw option value.
 * @returns {void}
 */
function assignOptionValue(parsed, spec, value) {
  const nextValue = spec.parse ? spec.parse(value) : value;

  if (spec.validate && !spec.validate(nextValue)) {
    throw new Error(spec.invalidMessage || spec.missingMessage);
  }

  if (spec.append) {
    const values = Array.isArray(nextValue) ? nextValue : [nextValue];
    parsed[spec.key].push(...values);
    return;
  }

  parsed[spec.key] = nextValue;
}

/**
 * Parse common CLI flags.
 *
 * @param {string[]} argv - CLI arguments.
 * @param {object} [config={}] - Parser configuration.
 * @param {object} [config.defaults={}] - Default option values.
 * @param {object} [config.flags={}] - Boolean flag map.
 * @param {object} [config.options={}] - Value option map.
 * @param {boolean} [config.allowPositionalProjectDir=false] - Allow one root.
 * @returns {object} Parsed options.
 */
export function parseArgs(argv, config = {}) {
  const {
    defaults = {},
    flags = {},
    options = {},
    allowPositionalProjectDir = false,
  } = config;
  const parsed = cloneDefaults(defaults);
  let positionalProjectDirFound = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(flags, arg)) {
      const spec = normalizeFlagSpec(flags[arg]);
      parsed[spec.key] = spec.value;
      continue;
    }

    const [inlineName, inlineValue] = arg.startsWith('--')
      ? arg.split(/=(.*)/s, 2)
      : [arg, undefined];
    const optionName = Object.prototype.hasOwnProperty.call(options, arg)
      ? arg
      : inlineValue !== undefined && options[inlineName]
        ? inlineName
        : undefined;

    if (optionName) {
      const spec = options[optionName];
      const value =
        inlineValue === undefined
          ? readNextValue(argv, index, spec)
          : inlineValue;
      assignOptionValue(parsed, spec, value);
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }

    if (allowPositionalProjectDir && !arg.startsWith('--')) {
      if (positionalProjectDirFound) {
        throw new Error(`Unknown option: ${arg}`);
      }
      parsed.projectDir = arg;
      positionalProjectDirFound = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}
