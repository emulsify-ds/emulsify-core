/**
 * @file Tests for shared process helpers.
 */

import { run } from './proc.js';

describe('script process helpers', () => {
  it('returns stdout in exec mode', () => {
    const stdout = run(
      process.execPath,
      ['--eval', 'process.stdout.write("exec-output")'],
      { mode: 'exec' },
    );

    expect(stdout).toBe('exec-output');
  });

  it('returns the spawn result by default', () => {
    const result = run(process.execPath, [
      '--eval',
      'process.stdout.write("spawn-output")',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('spawn-output');
  });

  it('throws a caller-provided message when a spawn exits non-zero', () => {
    expect(() =>
      run(process.execPath, ['--eval', 'process.exit(7)'], {
        failureMessage: ({ status }) => `custom exit ${status}`,
      }),
    ).toThrow('custom exit 7');
  });
});
