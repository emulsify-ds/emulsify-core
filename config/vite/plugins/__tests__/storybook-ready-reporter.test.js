/**
 * @file Tests for the Storybook ready-box interception.
 */

import {
  interceptReadyBox,
  isReadyBox,
  parseReadyUrls,
  portFromUrl,
  requestedPortFromArgv,
} from '../../../../.storybook/ready-reporter.js';

/**
 * A realistic payload from Storybook's startup box.
 *
 * @type {string}
 */
const READY_BOX = `Storybook ready!

- Local:            http://localhost:6007/
- On your network:  http://192.168.1.25:6007/`;

/**
 * Build an ANSI SGR sequence.
 *
 * Constructed rather than written literally so the escape character stays out of
 * the source, where it is invisible and easy to delete by accident.
 *
 * @param {number} code - SGR parameter.
 * @returns {string} Escape sequence.
 */
const sgr = (code) => `${String.fromCharCode(27)}[${code}m`;

describe('ready box detection', () => {
  it('recognizes the startup box', () => {
    expect(isReadyBox(READY_BOX)).toBe(true);
  });

  it('recognizes it through ansi styling', () => {
    expect(isReadyBox(`${sgr(32)}Storybook ready!${sgr(39)}`)).toBe(true);
  });

  it('leaves every other boxed message alone', () => {
    // Storybook boxes migration notices and error summaries too. This exists to
    // unify one visual element, not to take over Storybook's output.
    expect(isReadyBox('Migration required: run npx storybook upgrade')).toBe(
      false,
    );
    expect(isReadyBox(undefined)).toBe(false);
  });
});

describe('ready box parsing', () => {
  it('extracts the local and network urls', () => {
    expect(parseReadyUrls(READY_BOX)).toEqual({
      local: 'http://localhost:6007/',
      network: 'http://192.168.1.25:6007/',
    });
  });

  it('extracts urls through ansi styling', () => {
    const styled = `Storybook ready!\n\n- ${sgr(1)}Local${sgr(22)}:  ${sgr(36)}http://localhost:6006/${sgr(39)}`;
    expect(parseReadyUrls(styled).local).toBe('http://localhost:6006/');
  });

  it('tolerates a box with no network row', () => {
    const urls = parseReadyUrls(
      'Storybook ready!\n\n- Local: http://localhost:6006/',
    );
    expect(urls).toEqual({ local: 'http://localhost:6006/' });
  });

  it('returns nothing useful for an unparseable payload', () => {
    expect(parseReadyUrls('Storybook ready!')).toEqual({});
    expect(parseReadyUrls(42)).toEqual({});
  });

  it('reads the port out of a url', () => {
    expect(portFromUrl('http://localhost:6007/')).toBe('6007');
    expect(portFromUrl('not a url')).toBeUndefined();
    expect(portFromUrl(undefined)).toBeUndefined();
  });
});

describe('requested port', () => {
  it('reads the short and long flags', () => {
    expect(requestedPortFromArgv(['node', 'sb', 'dev', '-p', '6006'])).toBe(
      '6006',
    );
    expect(requestedPortFromArgv(['node', 'sb', 'dev', '--port', '7000'])).toBe(
      '7000',
    );
    expect(requestedPortFromArgv(['node', 'sb', 'dev', '--port=7001'])).toBe(
      '7001',
    );
  });

  it('returns nothing when no port was requested', () => {
    expect(requestedPortFromArgv(['node', 'sb', 'dev'])).toBeUndefined();
    expect(requestedPortFromArgv(['node', 'sb', '-p'])).toBeUndefined();
    expect(requestedPortFromArgv(undefined)).toBeUndefined();
  });
});

describe('ready box interception', () => {
  /**
   * Build a fake Storybook logger with a recording box method.
   *
   * @returns {{logger: object, boxed: string[], lines: string[]}} Harness.
   */
  function createHarness() {
    const boxed = [];
    const lines = [];
    const logger = {
      logBox: (message) => {
        boxed.push(message);
      },
    };

    return { logger, boxed, lines };
  }

  it('replaces the ready box with the emulsify panel', () => {
    const { logger, boxed, lines } = createHarness();

    const installed = interceptReadyBox({
      logger,
      write: (line) => lines.push(line),
      colorEnabled: false,
      unicodeEnabled: true,
    });
    logger.logBox(READY_BOX);

    expect(installed).toBe(true);
    expect(boxed).toEqual([]);

    const output = lines.join('\n');
    expect(output).toContain('storybook ready');
    expect(output).toContain('http://localhost:6007/');
    expect(output).toContain('http://192.168.1.25:6007/');
    expect(output).toMatch(/[▄▀]/);
    expect(output).not.toContain('Storybook ready!');
  });

  it('passes other boxed messages through untouched', () => {
    const { logger, boxed, lines } = createHarness();

    interceptReadyBox({
      logger,
      write: (line) => lines.push(line),
      colorEnabled: false,
    });
    logger.logBox('Something else entirely', { rounded: true });

    expect(boxed).toEqual(['Something else entirely']);
    expect(lines).toEqual([]);
  });

  it('warns when storybook resolved a port it was not asked for', () => {
    // `--ci` makes Storybook fall forward silently, so a stale session on the
    // requested port would otherwise send the developer to the wrong instance.
    const { logger, lines } = createHarness();

    interceptReadyBox({
      logger,
      requestedPort: '6006',
      write: (line) => lines.push(line),
      colorEnabled: false,
      unicodeEnabled: true,
    });
    logger.logBox(READY_BOX);

    expect(lines.join('\n')).toContain('port 6006 in use, using 6007');
  });

  it('stays quiet when the resolved port matches the request', () => {
    const { logger, lines } = createHarness();

    interceptReadyBox({
      logger,
      requestedPort: '6007',
      write: (line) => lines.push(line),
      colorEnabled: false,
    });
    logger.logBox(READY_BOX);

    expect(lines.join('\n')).not.toContain('in use');
  });

  it('falls back to storybook’s own box when rendering throws', () => {
    const boxed = [];
    const logger = {
      logBox: (message) => {
        boxed.push(message);
      },
    };

    interceptReadyBox({
      logger,
      write: () => {
        throw new Error('stream closed');
      },
      colorEnabled: false,
    });
    logger.logBox(READY_BOX);

    // A failure here must not cost the developer the URLs they need.
    expect(boxed).toEqual([READY_BOX]);
  });

  it('declines to wrap a logger without a box method', () => {
    expect(interceptReadyBox({ logger: {} })).toBe(false);
    expect(interceptReadyBox({})).toBe(false);
    expect(interceptReadyBox()).toBe(false);
  });
});
