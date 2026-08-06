/**
 * @file Tests for which invocations replace Dart Sass's own output.
 *
 * Storybook resolves the shared Vite config with `command: 'serve'` and no
 * watch flag, so it used to miss the branch that installs the quiet logger. It
 * printed Dart Sass's full formatted block for every deprecation — hundreds of
 * lines at startup and again after every save, restating a tally the develop
 * reporter had already printed once from the sibling process.
 */

import { shouldQuietSass } from '../reporter/sass-logger.js';

describe('shouldQuietSass', () => {
  it('quiets the Storybook dev server', () => {
    expect(shouldQuietSass({ command: 'serve' })).toBe(true);
  });

  it('quiets the develop watcher', () => {
    expect(shouldQuietSass({ watching: true, command: 'build' })).toBe(true);
  });

  it('leaves a one-shot build printing Sass output itself', () => {
    // Nothing else runs alongside `npm run build` to report the debt, so Dart
    // Sass's own output is the only report there is.
    expect(shouldQuietSass({ command: 'build' })).toBe(false);
  });

  it('hands Storybook its raw output back in verbose mode', () => {
    expect(shouldQuietSass({ command: 'serve', verbose: true })).toBe(false);
  });

  it('keeps the watcher quiet even in verbose mode', () => {
    // Raw mode restores Vite's own chatter, but the reporter still prints the
    // deduplicated tally and several hundred Sass blocks would bury it.
    expect(
      shouldQuietSass({ watching: true, command: 'build', verbose: true }),
    ).toBe(true);
  });

  it('defaults to leaving Sass alone', () => {
    expect(shouldQuietSass()).toBe(false);
  });
});
