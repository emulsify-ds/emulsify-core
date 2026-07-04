/**
 * @file Tests for shared CLI helpers.
 */

import { createUsage, isCliEntrypoint, parseArgs } from './cli.js';

describe('script CLI helpers', () => {
  it('formats standard usage text', () => {
    expect(createUsage('Usage: command', ['  --help  Print help.'])).toBe(
      ['Usage: command', '', 'Options:', '  --help  Print help.'].join('\n'),
    );
  });

  it('recognizes source script and package bin entrypoints', () => {
    expect(
      isCliEntrypoint(
        ['audit.js', 'emulsify-audit'],
        ['node', '/repo/scripts/audit.js'],
      ),
    ).toBe(true);
    expect(
      isCliEntrypoint(
        ['audit.js', 'emulsify-audit'],
        ['node', '/repo/node_modules/.bin/emulsify-audit'],
      ),
    ).toBe(true);
    expect(
      isCliEntrypoint(
        ['audit.js', 'emulsify-audit'],
        ['node', '/repo/scripts/other.js'],
      ),
    ).toBe(false);
  });

  it('parses shared help, json, flag, and value patterns', () => {
    const parsed = parseArgs(['--json', '--fail-on-found', '--root', 'theme'], {
      defaults: {
        projectDir: 'cwd',
        failOnFound: false,
        json: false,
        help: false,
      },
      flags: {
        '--fail-on-found': 'failOnFound',
        '--json': 'json',
      },
      options: {
        '--root': {
          key: 'projectDir',
          missingMessage: '--root requires a project directory.',
        },
      },
    });

    expect(parsed).toEqual({
      projectDir: 'theme',
      failOnFound: true,
      json: true,
      help: false,
    });
  });

  it('parses inline and numeric value options', () => {
    const parsed = parseArgs(['--root=theme', '--twig-threshold=12'], {
      defaults: {
        projectDir: 'cwd',
        twigThreshold: 250,
      },
      options: {
        '--root': {
          key: 'projectDir',
          missingMessage: '--root requires a project directory.',
        },
        '--twig-threshold': {
          key: 'twigThreshold',
          parse: Number,
          validate: Number.isFinite,
          missingMessage: '--twig-threshold requires a number.',
        },
      },
    });

    expect(parsed).toEqual({
      projectDir: 'theme',
      twigThreshold: 12,
    });
  });

  it('appends repeated option values without mutating defaults', () => {
    const config = {
      defaults: {
        fixtureNames: [],
      },
      options: {
        '--fixture': {
          key: 'fixtureNames',
          append: true,
          parse: (value) => value.split(','),
          missingMessage: '--fixture requires a fixture name.',
        },
      },
    };

    expect(
      parseArgs(['--fixture', 'one,two', '--fixture=three'], config)
        .fixtureNames,
    ).toEqual(['one', 'two', 'three']);
    expect(parseArgs([], config).fixtureNames).toEqual([]);
  });

  it('keeps positional project directories opt-in', () => {
    const config = {
      defaults: {
        projectDir: 'cwd',
      },
    };

    expect(() => parseArgs(['theme'], config)).toThrow('Unknown option: theme');
    expect(
      parseArgs(['theme'], {
        ...config,
        allowPositionalProjectDir: true,
      }).projectDir,
    ).toBe('theme');
  });

  it('preserves existing missing value messages', () => {
    expect(() =>
      parseArgs(['--root', '--json'], {
        defaults: {
          projectDir: 'cwd',
        },
        options: {
          '--root': {
            key: 'projectDir',
            missingMessage: '--root requires a project directory.',
          },
        },
      }),
    ).toThrow('--root requires a project directory.');

    expect(() =>
      parseArgs(['--twig-threshold=bad'], {
        defaults: {
          twigThreshold: 250,
        },
        options: {
          '--twig-threshold': {
            key: 'twigThreshold',
            parse: Number,
            validate: Number.isFinite,
            missingMessage: '--twig-threshold requires a number.',
          },
        },
      }),
    ).toThrow('--twig-threshold requires a number.');
  });
});
