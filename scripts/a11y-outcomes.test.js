/**
 * @file Deterministic reporting and worker-drain coverage for accessibility runs.
 */

import pa11y from 'pa11y';
import a11yConfig from '../config/a11y.config.js';
import { applyProjectA11yConfig, lintReportAndExit } from './a11y.js';

jest.mock('pa11y', () => jest.fn());

const baseUrl = 'http://127.0.0.1:4321/iframe.html';
const storyUrl = (id) => `${baseUrl}?id=${id}`;
const storyId = (url) => new URL(url).searchParams.get('id');
const issue = (code, message = code) => ({
  code,
  type: 'error',
  message,
  context: '<button>Action</button>',
  selector: 'button',
  runnerExtras: {},
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const gatedChecks = (names) => {
  const jobs = new Map(
    names.map((name) => [
      name,
      { started: deferred(), completed: deferred(), result: deferred() },
    ]),
  );
  const state = { active: 0, peak: 0, completed: [] };

  pa11y.mockImplementation((url) => {
    const id = storyId(url);
    const job = jobs.get(id);
    state.active += 1;
    state.peak = Math.max(state.peak, state.active);
    job.started.resolve();
    return job.result.promise.finally(() => {
      state.active -= 1;
      state.completed.push(id);
      job.completed.resolve();
    });
  });

  return { jobs, state };
};

const reportedIds = (events, names) =>
  events.flatMap((line) => {
    const id = line.match(/\?id=([^\s]+)/)?.[1];
    return names.includes(id) ? [id] : [];
  });

describe('accessibility run outcomes', () => {
  let events;
  let originalExitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = 0;
    events = [];
    const record = (...args) => events.push(args.map(String).join(' '));
    jest.spyOn(console, 'log').mockImplementation(record);
    jest.spyOn(console, 'error').mockImplementation(record);
    pa11y.mockReset();
    applyProjectA11yConfig({
      concurrency: 2,
      ignore: { codes: ['ignored-rule'], descriptions: [] },
    });
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    applyProjectA11yConfig(a11yConfig);
    jest.restoreAllMocks();
  });

  it('reports clean, ignored-only, finding, and failed stories in input order', async () => {
    const names = ['clean', 'ignored', 'violation', 'broken', 'later-clean'];
    const failure = new Error('Browser disconnected');
    pa11y.mockImplementation((pageUrl) => {
      const id = storyId(pageUrl);
      if (id === 'broken') return Promise.reject(failure);
      const issues =
        id === 'ignored'
          ? [issue('ignored-rule', 'Do not print this ignored issue')]
          : id === 'violation'
            ? [issue('real-rule', 'Visible accessibility finding')]
            : [];
      return Promise.resolve({ issues, pageUrl });
    });

    const error = await lintReportAndExit(names, { baseUrl }).catch(
      (caught) => caught,
    );

    // This assertion captures the original bug: one failure discarded all reports.
    expect(events).toContain(
      `No issues found in component: ${storyUrl('clean')}`,
    );
    expect(reportedIds(events, names)).toEqual(names);
    expect(events.join('\n')).toContain('Visible accessibility finding');
    expect(events.join('\n')).not.toContain('Do not print this ignored issue');
    expect(events).toContain(
      `No issues found in component: ${storyUrl('ignored')}`,
    );
    expect(events.at(-1)).toBe(
      'Accessibility summary: 5 attempted, 3 clean, 1 with findings, 1 failed to execute.',
    );
    expect(events.join('\n')).toContain(failure.message);
    expect(console.error).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toHaveLength(1);
    expect(error.errors[0]).toMatchObject({
      storyId: 'broken',
      url: storyUrl('broken'),
      cause: failure,
    });
    expect(error.errors[0].cause).toBe(failure);
    expect(process.exitCode).toBe(1);
  });

  it('preserves every execution failure after all reports and the summary', async () => {
    const names = ['first-failure', 'middle-clean', 'last-failure'];
    applyProjectA11yConfig({ concurrency: 5 });
    const { jobs, state } = gatedChecks(names);
    const firstFailure = new Error('First browser failed');
    const lastFailure = new Error('Last browser failed');
    const completedRun = lintReportAndExit(names, { baseUrl }).catch(
      (error) => error,
    );

    await Promise.all(names.map((name) => jobs.get(name).started.promise));
    jobs.get('last-failure').result.reject(lastFailure);
    await jobs.get('last-failure').completed.promise;
    jobs.get('middle-clean').result.resolve({
      issues: [],
      pageUrl: storyUrl('middle-clean'),
    });
    await jobs.get('middle-clean').completed.promise;
    jobs.get('first-failure').result.reject(firstFailure);
    const error = await completedRun;

    expect(reportedIds(events, names)).toEqual(names);
    expect(events.at(-1)).toBe(
      'Accessibility summary: 3 attempted, 1 clean, 0 with findings, 2 failed to execute.',
    );
    expect(state.active).toBe(0);
    expect(state.completed).toEqual([
      'last-failure',
      'middle-clean',
      'first-failure',
    ]);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toHaveLength(2);
    expect(error.errors[0]).toBeInstanceOf(Error);
    expect(error.errors[1]).toBeInstanceOf(Error);
    expect(error.errors).toEqual([
      expect.objectContaining({
        storyId: 'first-failure',
        url: storyUrl('first-failure'),
        cause: firstFailure,
      }),
      expect.objectContaining({
        storyId: 'last-failure',
        url: storyUrl('last-failure'),
        cause: lastFailure,
      }),
    ]);
    expect(error.errors[0].cause).toBe(firstFailure);
    expect(error.errors[1].cause).toBe(lastFailure);
    expect(process.exitCode).toBe(1);
  });

  it.each([1, 2, 5])(
    'drains every story exactly once with concurrency %i using explicit gates',
    async (limit) => {
      const names = Array.from({ length: 11 }, (_, index) => `story-${index}`);
      applyProjectA11yConfig({ concurrency: limit });
      const { jobs, state } = gatedChecks(names);
      const completedRun = lintReportAndExit(names, { baseUrl });

      for (let offset = 0; offset < names.length; offset += limit) {
        const batch = names.slice(offset, offset + limit);
        await Promise.all(batch.map((name) => jobs.get(name).started.promise));
        expect(state.active).toBeLessThanOrEqual(limit);
        expect(pa11y).toHaveBeenCalledTimes(offset + batch.length);
        for (const name of [...batch].reverse()) {
          jobs
            .get(name)
            .result.resolve({ issues: [], pageUrl: storyUrl(name) });
          await jobs.get(name).completed.promise;
        }
      }

      await expect(completedRun).resolves.toBeUndefined();
      expect(state.peak).toBe(limit);
      expect(state.active).toBe(0);
      expect(state.completed).toHaveLength(names.length);
      expect(new Set(state.completed).size).toBe(names.length);
      expect(pa11y.mock.calls.map(([url]) => storyId(url))).toEqual(names);
      expect(reportedIds(events, names)).toEqual(names);
      expect(events.at(-1)).toBe(
        'Accessibility summary: 11 attempted, 11 clean, 0 with findings, 0 failed to execute.',
      );
      expect(process.exitCode).toBe(0);
    },
  );

  it('summarizes empty input without starting a check', async () => {
    await expect(lintReportAndExit([], { baseUrl })).resolves.toBeUndefined();

    expect(pa11y).not.toHaveBeenCalled();
    expect(events).toEqual([
      'Accessibility summary: 0 attempted, 0 clean, 0 with findings, 0 failed to execute.',
    ]);
    expect(process.exitCode).toBe(0);
  });

  it('resolves without a return value when completed checks contain findings', async () => {
    pa11y.mockResolvedValue({
      pageUrl: storyUrl('violation'),
      issues: [issue('real-rule')],
    });

    await expect(
      lintReportAndExit(['violation'], { baseUrl }),
    ).resolves.toBeUndefined();

    expect(process.exitCode).toBe(1);
    expect(events.at(-1)).toBe(
      'Accessibility summary: 1 attempted, 0 clean, 1 with findings, 0 failed to execute.',
    );
  });

  it('preserves a prior nonzero status when execution also fails', async () => {
    process.exitCode = 7;
    pa11y.mockRejectedValue(new Error('Browser unavailable'));

    await expect(
      lintReportAndExit(['broken'], { baseUrl }),
    ).rejects.toBeInstanceOf(AggregateError);

    expect(process.exitCode).toBe(7);
  });

  it.each([1, 7])(
    'preserves prior exit code %i after clean and ignored reports',
    async (exitCode) => {
      process.exitCode = exitCode;
      pa11y.mockImplementation((pageUrl) =>
        Promise.resolve({
          pageUrl,
          issues: storyId(pageUrl) === 'ignored' ? [issue('ignored-rule')] : [],
        }),
      );

      await expect(
        lintReportAndExit(['clean', 'ignored'], { baseUrl }),
      ).resolves.toBeUndefined();

      expect(process.exitCode).toBe(exitCode);
      expect(events.at(-1)).toBe(
        'Accessibility summary: 2 attempted, 2 clean, 0 with findings, 0 failed to execute.',
      );
    },
  );
});
