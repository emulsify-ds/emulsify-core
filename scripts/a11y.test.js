/**
 * @file Unit tests for the pa11y accessibility reporting script.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { get } from 'http';
import { tmpdir } from 'os';
import path from 'path';
import pa11y from 'pa11y';

import a11yConfig from '../config/a11y.config.js';
import {
  applyProjectA11yConfig,
  discoverStoryIds,
  severityToColor,
  issueIsValid,
  logIssue,
  logReport,
  lintComponent,
  lintReportAndExit,
  resolvePa11yStoryIds,
  resolveProjectA11yConfig,
  resolveStorybookBuildDir,
  startStorybookServer,
  storyIdsFromStorybookIndex,
} from './a11y.js';

jest.spyOn(global.process, 'exit').mockImplementation(() => {});
jest.mock('pa11y', () => jest.fn());
jest.spyOn(global.console, 'log').mockImplementation(() => {});
const { ignore, storybookBuildDir, pa11y: pa11yConfig } = a11yConfig;

const STORYBOOK_BUILD_DIR = path.resolve(process.cwd(), storybookBuildDir);
const STORYBOOK_IFRAME = path.join(STORYBOOK_BUILD_DIR, 'iframe.html');

pa11y.mockResolvedValue('very official report');

const tempDirs = [];
const originalExitCode = process.exitCode;

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

function readUrl(url) {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

describe('a11y', () => {
  beforeEach(() => {
    // Reset mocked process and console state between report scenarios.
    global.console.log.mockClear();
    global.process.exit.mockClear();
    pa11y.mockClear();
    applyProjectA11yConfig({ concurrency: 2 });
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
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

  it('resolves generated-consumer paths from the project root', () => {
    const projectDir = path.join(tmpdir(), 'packed-consumer');

    expect(resolveStorybookBuildDir('.out', projectDir)).toBe(
      path.join(projectDir, '.out'),
    );
    expect(resolveProjectA11yConfig(projectDir)).toBe(
      path.join(projectDir, 'config/emulsify-core/a11y.config.js'),
    );
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

  it('can call pa11y through a served Storybook origin', async () => {
    await lintComponent('chicken-strips', {
      baseUrl: 'http://127.0.0.1:4321/iframe.html',
    });

    expect(pa11y).toHaveBeenLastCalledWith(
      'http://127.0.0.1:4321/iframe.html?id=chicken-strips',
      pa11yConfig,
    );
  });

  it('serves built Storybook files over loopback HTTP', async () => {
    const buildDir = makeStorybookBuild();
    writeFileSync(path.join(buildDir, 'iframe.html'), 'Storybook ready');
    const server = await startStorybookServer(buildDir);

    try {
      await expect(readUrl(`${server.baseUrl}/iframe.html`)).resolves.toBe(
        'Storybook ready',
      );
    } finally {
      await server.close();
    }
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
    expect(process.exitCode).toBe(1);
  });

  it.each([2, 4])(
    'scans all 80 IDs once with at most %i checks and reports in input order',
    async (limit) => {
      if (limit !== 2) applyProjectA11yConfig({ concurrency: limit });
      const names = Array.from({ length: 80 }, (_, index) => `story-${index}`);
      let active = 0;
      let peak = 0;
      const completed = [];
      pa11y.mockImplementation(async (pageUrl) => {
        active += 1;
        peak = Math.max(peak, active);
        const id = new URL(pageUrl).searchParams.get('id');
        const index = names.indexOf(id);
        await new Promise((resolve) =>
          setTimeout(resolve, index % 2 === 0 ? 5 : 0),
        );
        active -= 1;
        completed.push(id);
        return { issues: [], pageUrl };
      });

      await lintReportAndExit(names, {
        baseUrl: 'http://localhost/iframe.html',
      });

      expect(peak).toBe(limit);
      expect(active).toBe(0);
      expect(
        pa11y.mock.calls.map(([url]) => new URL(url).searchParams.get('id')),
      ).toEqual(names);
      expect(completed).not.toEqual(names);
      expect(
        global.console.log.mock.calls
          .filter(([line]) => line.startsWith('No issues found in component:'))
          .map(([line]) => line.split('?id=')[1]),
      ).toEqual(names);
      expect(process.exitCode).toBe(0);
    },
  );

  it('drains all 80 IDs and in-flight checks before server cleanup after rejection', async () => {
    const buildDir = makeStorybookBuild();
    writeFileSync(path.join(buildDir, 'iframe.html'), 'Storybook ready');
    const server = await startStorybookServer(buildDir);
    const names = Array.from({ length: 80 }, (_, index) => `story-${index}`);
    const failure = new Error('Browser failed');
    let active = 0;
    let peak = 0;
    const completed = [];
    pa11y.mockImplementation(async (pageUrl) => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        if (pageUrl.endsWith('id=story-0')) throw failure;
        await new Promise((resolve) => setTimeout(resolve, 1));
        expect(await readUrl(`${server.baseUrl}/iframe.html`)).toBe(
          'Storybook ready',
        );
        return { issues: [], pageUrl };
      } finally {
        active -= 1;
        completed.push(pageUrl);
      }
    });

    try {
      await expect(
        lintReportAndExit(names, { baseUrl: `${server.baseUrl}/iframe.html` }),
      ).rejects.toMatchObject({
        name: 'AggregateError',
        errors: [
          expect.objectContaining({
            storyId: 'story-0',
            url: `${server.baseUrl}/iframe.html?id=story-0`,
            cause: failure,
          }),
        ],
      });
      expect(active).toBe(0);
      expect(peak).toBeLessThanOrEqual(2);
      expect(completed).toHaveLength(80);
      expect(
        pa11y.mock.calls.map(([url]) => new URL(url).searchParams.get('id')),
      ).toEqual(names);
      expect(
        global.console.log.mock.calls.filter(([line]) =>
          line.startsWith('No issues found in component:'),
        ),
      ).toHaveLength(79);
      expect(global.console.log).toHaveBeenLastCalledWith(
        'Accessibility summary: 80 attempted, 79 clean, 0 with findings, 1 failed to execute.',
      );
    } finally {
      await server.close();
    }
    await expect(readUrl(`${server.baseUrl}/iframe.html`)).rejects.toThrow();
  });

  it.each([0, -1, 1.5, '2', Infinity, NaN])(
    'rejects invalid concurrency %s',
    (concurrency) => {
      expect(() => applyProjectA11yConfig({ concurrency })).toThrow(
        'Accessibility concurrency must be a positive integer.',
      );
    },
  );
});
