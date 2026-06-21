/**
 * @file Unit tests for the pa11y accessibility reporting script.
 */

import 'regenerator-runtime/runtime';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import pa11y from 'pa11y';

import a11yConfig from '../config/a11y.config.js';
import {
  discoverStoryIds,
  severityToColor,
  issueIsValid,
  logIssue,
  logReport,
  lintComponent,
  lintReportAndExit,
  resolvePa11yStoryIds,
  storyIdsFromStorybookIndex,
} from './a11y.js';

jest.spyOn(global.process, 'exit').mockImplementation(() => {});
jest.mock('pa11y', () => jest.fn());
jest.spyOn(global.console, 'log').mockImplementation(() => {});
const { ignore, storybookBuildDir, pa11y: pa11yConfig } = a11yConfig;

const STORYBOOK_BUILD_DIR = path.resolve(__dirname, '../', storybookBuildDir);
const STORYBOOK_IFRAME = path.join(STORYBOOK_BUILD_DIR, 'iframe.html');

pa11y.mockResolvedValue('very official report');

const tempDirs = [];

function makeStorybookBuild(indexSource) {
  const buildDir = mkdtempSync(path.join(tmpdir(), 'emulsify-a11y-'));
  tempDirs.push(buildDir);
  mkdirSync(buildDir, { recursive: true });

  if (indexSource !== undefined) {
    writeFileSync(
      path.join(buildDir, 'index.json'),
      typeof indexSource === 'string'
        ? indexSource
        : JSON.stringify(indexSource, null, 2),
    );
  }

  return buildDir;
}

describe('a11y', () => {
  beforeEach(() => {
    // Reset mocked process and console state between report scenarios.
    global.console.log.mockClear();
    global.process.exit.mockClear();
  });

  afterEach(() => {
    for (const tempDir of tempDirs) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('discovers story IDs from Storybook index entries', () => {
    expect(
      storyIdsFromStorybookIndex({
        entries: {
          'components-button--primary': {
            id: 'components-button--primary',
            type: 'story',
          },
          'components-button--docs': {
            id: 'components-button--docs',
            type: 'docs',
          },
          'components-card--default': {
            type: 'story',
          },
        },
      }),
    ).toEqual(['components-button--primary', 'components-card--default']);
  });

  it('discovers story IDs from built Storybook index.json', () => {
    const buildDir = makeStorybookBuild({
      v: 5,
      entries: {
        'components-button--primary': {
          id: 'components-button--primary',
          type: 'story',
          title: 'Components/Button',
          name: 'Primary',
        },
        'components-card--default': {
          id: 'components-card--default',
          type: 'story',
          title: 'Components/Card',
          name: 'Default',
        },
      },
    });

    expect(discoverStoryIds(buildDir, { warn: jest.fn() })).toEqual([
      'components-button--primary',
      'components-card--default',
    ]);
  });

  it('keeps manual-only configuration when discovery is disabled', () => {
    const warn = jest.fn();

    expect(
      resolvePa11yStoryIds({
        manualIds: ['manual-card--default'],
        discover: false,
        warn,
      }),
    ).toEqual(['manual-card--default']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('merges discovered and manual story IDs', () => {
    const buildDir = makeStorybookBuild({
      entries: {
        'components-button--primary': {
          id: 'components-button--primary',
          type: 'story',
        },
      },
    });

    expect(
      resolvePa11yStoryIds({
        manualIds: ['manual-card--default'],
        buildDir,
        warn: jest.fn(),
      }),
    ).toEqual(['manual-card--default', 'components-button--primary']);
  });

  it('deduplicates manual and discovered story IDs', () => {
    const buildDir = makeStorybookBuild({
      entries: {
        'components-button--primary': {
          id: 'components-button--primary',
          type: 'story',
        },
        'components-card--default': {
          id: 'components-card--default',
          type: 'story',
        },
        'components-card--duplicate': {
          id: 'components-card--default',
          type: 'story',
        },
      },
    });

    expect(
      resolvePa11yStoryIds({
        manualIds: ['components-button--primary', 'manual-card--default'],
        buildDir,
        warn: jest.fn(),
      }),
    ).toEqual([
      'components-button--primary',
      'manual-card--default',
      'components-card--default',
    ]);
  });

  it('falls back to manual IDs with a warning when index.json is missing', () => {
    const buildDir = makeStorybookBuild();
    const warn = jest.fn();

    expect(
      resolvePa11yStoryIds({
        manualIds: ['manual-card--default'],
        buildDir,
        warn,
      }),
    ).toEqual(['manual-card--default']);
    expect(warn.mock.calls[0][0]).toContain('Storybook index not found');
  });

  it('falls back to manual IDs with a warning when index.json is malformed', () => {
    const buildDir = makeStorybookBuild('{not-json');
    const warn = jest.fn();

    expect(
      resolvePa11yStoryIds({
        manualIds: ['manual-card--default'],
        buildDir,
        warn,
      }),
    ).toEqual(['manual-card--default']);
    expect(warn.mock.calls[0][0]).toContain('Unable to read Storybook index');
  });

  it('does not read Storybook index.json when discovery is disabled', () => {
    const buildDir = makeStorybookBuild({
      entries: {
        'components-button--primary': {
          id: 'components-button--primary',
          type: 'story',
        },
      },
    });
    const warn = jest.fn();

    expect(
      resolvePa11yStoryIds({
        manualIds: ['manual-card--default'],
        discover: false,
        buildDir,
        warn,
      }),
    ).toEqual(['manual-card--default']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('can map axe issue severity to the correct chalk color', () => {
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

  it('can use an axe issue to generate a single log message about the issue', () => {
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

  it('can log a whole axe report', () => {
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
      [
        [
          "Issues found in component: https://example/component.html",
        ],
        [
          "
      severity: error
      message: this pizza is too soggy
      context: https://example.com
      selector: pizza > .hut
      ",
        ],
        [
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

  it('logs about a component having no issue if a report comes back empty', () => {
    expect(logReport({ issues: [], pageUrl: 'papa-johns' })).toBe(false);
    expect(global.console.log.mock.calls[0][0]).toMatchInlineSnapshot(
      '"No issues found in component: papa-johns"',
    );
  });

  it('can call pa11y with the full path to a component', async () => {
    expect.assertions(2);
    await expect(lintComponent('chicken-strips')).resolves.toBe(
      'very official report',
    );
    expect(pa11y).toHaveBeenCalledWith(
      `${STORYBOOK_IFRAME}?id=chicken-strips`,
      pa11yConfig,
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
