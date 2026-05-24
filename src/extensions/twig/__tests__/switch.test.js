/**
 * @file Tests for native Twig switch/case/default tags.
 */

import Twig from 'twig';
import { registerTwigExtensions } from '../register.js';
import { splitSwitchCaseExpressions } from '../tags/switch.js';

/**
 * Render a Twig string with native Emulsify extensions registered.
 *
 * @param {string} data - Twig template source.
 * @param {Object} [context={}] - Twig render context.
 * @returns {string} Rendered Twig output.
 */
function render(data, context = {}) {
  registerTwigExtensions(Twig);

  return Twig.twig({ data }).render(context);
}

describe('splitSwitchCaseExpressions', () => {
  it('splits top-level or-delimited case values', () => {
    expect(
      splitSwitchCaseExpressions(
        '\u0027alpha\u0027 or \u0027beta\u0027 or variant',
      ),
    ).toEqual(['\u0027alpha\u0027', '\u0027beta\u0027', 'variant']);
  });

  it('preserves or text inside strings and nested expressions', () => {
    expect(
      splitSwitchCaseExpressions(
        '\u0027red or blue\u0027 or (fallback or alternate)',
      ),
    ).toEqual(['\u0027red or blue\u0027', '(fallback or alternate)']);
  });
});

describe('registered switch Twig tags', () => {
  it('renders the matching case body', () => {
    const output = render(
      `
        {% switch value %}
          {% case 'alpha' %}
            Alpha
          {% case 'beta' %}
            Beta
        {% endswitch %}
      `,
      { value: 'beta' },
    );

    expect(output).toContain('Beta');
    expect(output).not.toContain('Alpha');
  });

  it('supports multiple values on a case using or', () => {
    const output = render(
      `
        {% switch value %}
          {% case 'alpha' or 'beta' %}
            Matched
          {% default %}
            Default
        {% endswitch %}
      `,
      { value: 'beta' },
    );

    expect(output).toContain('Matched');
    expect(output).not.toContain('Default');
  });

  it('renders default when no case matches', () => {
    const output = render(
      `
        {% switch value %}
          {% case 'alpha' %}
            Alpha
          {% default %}
            Default
        {% endswitch %}
      `,
      { value: 'gamma' },
    );

    expect(output).toContain('Default');
    expect(output).not.toContain('Alpha');
  });

  it('returns no branch output when no case matches and no default exists', () => {
    const output = render(
      `
        Before
        {% switch value %}
          {% case 'alpha' %}
            Alpha
        {% endswitch %}
        After
      `,
      { value: 'gamma' },
    );

    expect(output).toContain('Before');
    expect(output).toContain('After');
    expect(output).not.toContain('Alpha');
  });

  it('supports case expressions from render context', () => {
    const output = render(
      `
        {% switch value %}
          {% case primary %}
            Primary
          {% case secondary %}
            Secondary
        {% endswitch %}
      `,
      {
        primary: 'alpha',
        secondary: 'beta',
        value: 'beta',
      },
    );

    expect(output).toContain('Secondary');
    expect(output).not.toContain('Primary');
  });

  it('uses PHP-style loose switch matching for scalar values', () => {
    const output = render(
      `
        {% switch value %}
          {% case '2' %}
            Numeric string
          {% default %}
            Default
        {% endswitch %}
      `,
      { value: 2 },
    );

    expect(output).toContain('Numeric string');
    expect(output).not.toContain('Default');
  });

  it('renders only the first matching case body', () => {
    const output = render(
      `
        {% switch value %}
          {% case 'beta' %}
            First
          {% case 'beta' %}
            Second
          {% default %}
            Default
        {% endswitch %}
      `,
      { value: 'beta' },
    );

    expect(output).toContain('First');
    expect(output).not.toContain('Second');
    expect(output).not.toContain('Default');
  });

  it('supports or text inside string case values', () => {
    const output = render(
      `
        {% switch value %}
          {% case 'red or blue' or 'green' %}
            Matched
          {% default %}
            Default
        {% endswitch %}
      `,
      { value: 'red or blue' },
    );

    expect(output).toContain('Matched');
    expect(output).not.toContain('Default');
  });
});
