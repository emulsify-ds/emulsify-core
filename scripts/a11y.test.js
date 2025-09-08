import 'regenerator-runtime/runtime';

const mockExit = jest
  .spyOn(global.process, 'exit')
  .mockImplementation(() => {});
jest.mock('pa11y', () => jest.fn());
jest.spyOn(global.console, 'log').mockImplementation(() => {});
const pa11y = require('pa11y');
const path = require('path');
const {
  severityToColor,
  issueIsValid,
  logIssue,
  logReport,
  lintComponent,
  lintReportAndExit,
} = require('./a11y');
const {
  ignore,
  storybookBuildDir,
  pa11y: pa11yConfig,
} = require('../config/a11y.config');

const STORYBOOK_BUILD_DIR = path.resolve(__dirname, '../', storybookBuildDir);
const STORYBOOK_IFRAME = path.join(STORYBOOK_BUILD_DIR, 'iframe.html');

pa11y.mockResolvedValue('very official report');

describe('a11y', () => {
  beforeEach(() => {
    global.console.log.mockClear();
    global.process.exit.mockClear();
  });

  it('maps axe issue severity to a label', () => {
    // (Name no longer mentions "chalk")
    expect.assertions(3);
    expect(severityToColor('error')).toBe('red');
    expect(severityToColor('warning')).toBe('yellow');
    expect(severityToColor('notice')).toBe('blue');
  });

  it('identifies invalid issues based on the code or the description', () => {
    expect.assertions(3);
    expect(
      issueIsValid({
        code: ignore.codes[0],
        runnerExtras: {},
      }),
    ).toBe(false);
    expect(
      issueIsValid({
        runnerExtras: {
          description: ignore.descriptions[0],
        },
      }),
    ).toBe(false);
    expect(issueIsValid({ code: 'chicken', runnerExtras: {} })).toBe(true);
  });

  it('logs a single issue without color codes', () => {
    expect.assertions(1);
    logIssue({
      type: 'error',
      message: 'this chicken is not fried enough.',
      context: 'https://example.com',
      selector: 'kfc > popeyes > .chicken',
    });
    expect(global.console.log.mock.calls[0][0]).toMatchInlineSnapshot(`
"
severity: error
message: this chicken is not fried enough.
context: https://example.com
selector: kfc > popeyes > .chicken
"
`);
  });

  it('logs a whole report without color codes', () => {
    const report = {
      issues: [
        {
          type: 'error',
          message: 'this pizza is too soggy',
          context: 'https://example.com',
          selector: 'pizza > .hut',
          runnerExtras: {},
        },
        {
          type: 'error',
          message: 'this pasta is undercooked',
          context: 'https://example.com',
          selector: 'olive > .garden',
          runnerExtras: {},
        },
      ],
      pageUrl: 'https://example/component.html',
    };
    expect(logReport(report)).toBe(true);
    expect(global.console.log.mock.calls).toMatchInlineSnapshot(`
Array [
  Array [
    "Issues found in component: https://example/component.html",
  ],
  Array [
    "
severity: error
message: this pizza is too soggy
context: https://example.com
selector: pizza > .hut
",
  ],
  Array [
    "
severity: error
message: this pasta is undercooked
context: https://example.com
selector: olive > .garden
",
  ],
]
`);
  });

  it('logs that a component has no issues when a report is empty', () => {
    expect(logReport({ issues: [], pageUrl: 'papa-johns' })).toBe(false);
    expect(global.console.log.mock.calls[0][0]).toMatchInlineSnapshot(
      `"No issues found in component: papa-johns"`,
    );
  });

  it('calls pa11y with the full path to a component', async () => {
    expect.assertions(3);
    await expect(lintComponent('chicken-strips')).resolves.toBe(
      'very official report',
    );

    // First arg: URL
    expect(pa11y.mock.calls[0][0]).toBe(
      `${STORYBOOK_IFRAME}?id=chicken-strips`,
    );

    // Second arg: options merged with defaults in a11y.js
    expect(pa11y.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        includeNotices: true,
        includeWarnings: true,
        runners: ['axe'],
        ...pa11yConfig,
      }),
    );
  });

  it('runs linter, reports on issues, and exits with code "1" if valid issues are found', async () => {
    expect.assertions(1);
    pa11y.mockResolvedValueOnce({
      issues: [
        {
          type: 'error',
          message: 'these 7 layer supreme burritos do not taste that good',
          context: 'https://example.com',
          selector: 'taco > bell > .burrito',
          runnerExtras: {},
        },
      ],
      pageUrl: '/path/to/taco-bell',
    });

    await lintReportAndExit(['taco-bell']);
    expect(global.process.exit).toHaveBeenCalledWith(1);
  });
});
