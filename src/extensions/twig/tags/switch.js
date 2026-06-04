/**
 * @file Native Twig.js switch/case/default logic tags.
 * @module extensions/twig/tags/switch
 */

const SWITCH_TAG_TYPE = 'emulsify_switch';
const CASE_TAG_TYPE = 'emulsify_case';
const DEFAULT_TAG_TYPE = 'emulsify_default';
const ENDSWITCH_TAG_TYPE = 'emulsify_endswitch';
const DOUBLE_QUOTE = '"';
const SINGLE_QUOTE = '\u0027';

const OPENING_BRACKETS = new Set(['(', '[', '{']);
const CLOSING_BRACKETS = new Set([')', ']', '}']);

/**
 * Determine whether a character can be part of a Twig identifier.
 *
 * @param {string} [character] - Character to inspect.
 * @returns {boolean} TRUE when the character is identifier-like.
 */
function isIdentifierCharacter(character) {
  return Boolean(character && /[A-Za-z0-9_]/.test(character));
}

/**
 * Split a case expression on top-level Twig `or` operators.
 *
 * Emulsify Tools uses `or` to express multiple PHP switch case values. Twig.js
 * receives the full tag body as a string, so split only when `or` appears
 * outside quotes and nested expressions.
 *
 * @param {string} expression - Raw `{% case ... %}` expression.
 * @returns {string[]} One or more Twig expressions to compile as case values.
 */
export function splitSwitchCaseExpressions(expression) {
  const parts = [];
  let quote = null;
  let escaped = false;
  let depth = 0;
  let start = 0;

  for (let index = 0; index < expression.length; index++) {
    const character = expression.charAt(index);

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === '\\') {
        escaped = true;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === DOUBLE_QUOTE || character === SINGLE_QUOTE) {
      quote = character;
      continue;
    }

    if (OPENING_BRACKETS.has(character)) {
      depth += 1;
      continue;
    }

    if (CLOSING_BRACKETS.has(character)) {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (
      depth === 0 &&
      expression.slice(index, index + 2) === 'or' &&
      !isIdentifierCharacter(expression.charAt(index - 1)) &&
      !isIdentifierCharacter(expression.charAt(index + 2))
    ) {
      const part = expression.slice(start, index).trim();
      if (part) {
        parts.push(part);
      }
      start = index + 2;
      index += 1;
    }
  }

  const tail = expression.slice(start).trim();
  if (tail) {
    parts.push(tail);
  }

  return parts;
}

/**
 * Compile a Twig expression into a stack Twig.js can parse later.
 *
 * @param {Object} Twig - Twig.js module.
 * @param {Object} state - Twig.js compile state.
 * @param {string} value - Twig expression source.
 * @returns {Object[]} Compiled expression stack.
 */
function compileExpression(Twig, state, value) {
  return Twig.expression.compile.call(state, {
    type: Twig.expression.type.expression,
    value,
  }).stack;
}

/**
 * Determine whether the current Twig logic chain belongs to an Emulsify switch.
 *
 * @param {*} chain - Twig.js logic chain value.
 * @returns {boolean} TRUE when the chain was opened by `{% switch %}`.
 */
function isSwitchChain(chain) {
  return Boolean(chain && chain.emulsifySwitch);
}

/**
 * Compare switch values using PHP-style loose switch semantics.
 *
 * @param {*} switchValue - Evaluated `{% switch ... %}` value.
 * @param {*} caseValue - Evaluated `{% case ... %}` value.
 * @returns {boolean} TRUE when the case matches.
 */
function isSwitchMatch(switchValue, caseValue) {
  // PHP switch statements use loose equality; mirror that for Drupal parity.
  return switchValue == caseValue;
}

/**
 * Render a token body and preserve the current switch chain.
 *
 * @param {Object} Twig - Twig.js module.
 * @param {Object} state - Twig.js parse state.
 * @param {Object} token - Compiled Twig.js logic token.
 * @param {Object} context - Twig render context.
 * @param {Object} chain - Active switch chain.
 * @returns {Object|Promise<Object>} Twig.js logic parse result.
 */
function renderSwitchBranch(Twig, state, token, context, chain) {
  return state.parseAsync(token.output || [], context).then((output) => ({
    chain,
    output,
  }));
}

/**
 * Create Twig.js logic tag definitions for switch/case/default/endswitch.
 *
 * @param {Object} Twig - Twig.js module or compatible extension target.
 * @returns {Object[]} Logic tag definitions.
 */
export function getSwitchTagDefinitions(Twig) {
  return [
    {
      type: SWITCH_TAG_TYPE,
      regex: /^switch\s+([\s\S]+)$/,
      next: [CASE_TAG_TYPE, DEFAULT_TAG_TYPE, ENDSWITCH_TAG_TYPE],
      open: true,
      compile(token) {
        token.stack = compileExpression(Twig, this, token.match[1]);
        delete token.match;
        return token;
      },
      parse(token, context) {
        const state = this;

        return Twig.expression.parseAsync
          .call(state, token.stack, context)
          .then((value) => ({
            chain: {
              emulsifySwitch: true,
              matched: false,
              value,
            },
            output: '',
          }));
      },
    },
    {
      type: CASE_TAG_TYPE,
      regex: /^case\s+([\s\S]+)$/,
      next: [CASE_TAG_TYPE, DEFAULT_TAG_TYPE, ENDSWITCH_TAG_TYPE],
      open: false,
      compile(token) {
        token.stacks = splitSwitchCaseExpressions(token.match[1]).map(
          (expression) => compileExpression(Twig, this, expression),
        );
        delete token.match;
        return token;
      },
      parse(token, context, chain) {
        const state = this;

        if (!isSwitchChain(chain)) {
          throw new Twig.Error('{% case %} must be used inside {% switch %}.');
        }

        if (chain.matched) {
          return {
            chain,
            output: '',
          };
        }

        return Twig.Promise.all(
          token.stacks.map((stack) =>
            Twig.expression.parseAsync.call(state, stack, context),
          ),
        ).then((values) => {
          if (
            !values.some((caseValue) => isSwitchMatch(chain.value, caseValue))
          ) {
            return {
              chain,
              output: '',
            };
          }

          chain.matched = true;
          return renderSwitchBranch(Twig, state, token, context, chain);
        });
      },
    },
    {
      type: DEFAULT_TAG_TYPE,
      regex: /^default$/,
      next: [ENDSWITCH_TAG_TYPE],
      open: false,
      parse(token, context, chain) {
        const state = this;

        if (!isSwitchChain(chain)) {
          throw new Twig.Error(
            '{% default %} must be used inside {% switch %}.',
          );
        }

        if (chain.matched) {
          return {
            chain,
            output: '',
          };
        }

        chain.matched = true;
        return renderSwitchBranch(Twig, state, token, context, chain);
      },
    },
    {
      type: ENDSWITCH_TAG_TYPE,
      regex: /^endswitch$/,
      next: [],
      open: false,
    },
  ];
}
