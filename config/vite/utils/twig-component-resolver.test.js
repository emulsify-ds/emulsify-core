/**
 * @file Regression checks for lazy component candidates and resolver boundaries.
 */

import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveComponentReference } from './twig-component-resolver.js';

describe('grouped component candidate lookup', () => {
  let project;
  let root;
  let cache;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(tmpdir(), 'twig-component-resolver-'));
    root = path.join(project, 'components');
    fs.mkdirSync(root);
    cache = new Map();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(project, { recursive: true, force: true });
  });

  const write = (relative) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '<p>Fixture</p>');
    return target;
  };
  const resolveReference = (reference = 'test_theme:card') =>
    resolveComponentReference(reference, { components: root }, cache);

  it.each(['atoms/button/button.twig', 'atoms/button'])(
    'does not discard the first directory in the bare path %s',
    (reference) => {
      write('molecules/button/button.twig');

      expect(resolveReference(reference)).toBeNull();
      expect(cache.size).toBe(0);
    },
  );

  it.each([
    'molecules/button/button.twig',
    'molecules/button',
    'components/molecules/button',
    '@components/molecules/button',
    'components:button',
    'components::button',
    'test_theme:button',
    '@test_theme/button',
  ])('preserves explicit paths and namespace shorthand in %s', (reference) => {
    const target = write('molecules/button/button.twig');

    expect(resolveReference(reference)).toBe(target);
  });

  it('does not construct later grouped candidates after the first match', () => {
    const winner = write('alpha/card.twig');
    write('zeta/deep/card.twig');
    const resolvePath = jest.spyOn(path, 'resolve');

    expect(resolveReference()).toBe(winner);
    const candidateRoots = resolvePath.mock.calls
      .filter((args) => args.length > 1 && args[1] === 'card')
      .map(([directory]) => directory);
    expect(candidateRoots).toContain(path.join(root, 'alpha'));
    expect(candidateRoots).not.toContain(path.join(root, 'zeta'));
    expect(candidateRoots).not.toContain(path.join(root, 'zeta/deep'));
    // Directory discovery remains eager and caller-cached; only candidates are lazy.
    expect(cache.get(root)).toEqual([
      path.join(root, 'alpha'),
      path.join(root, 'zeta'),
      path.join(root, 'zeta/deep'),
    ]);
  });

  it.each([
    ['direct', ['alpha/card.twig', 'card.twig'], 'card.twig'],
    [
      'breadth first',
      ['alpha/deep/card.twig', 'beta/card.twig'],
      'beta/card.twig',
    ],
    ['code point', ['alpha/card.twig', 'Zeta/card.twig'], 'Zeta/card.twig'],
  ])('preserves %s duplicate precedence', (name, candidates, expected) => {
    candidates.forEach(write);
    expect(resolveReference()).toBe(path.join(root, expected));
  });

  it('resolves the component root once for a grouped miss, regardless of group count', () => {
    write('alpha/deep/placeholder.twig');
    write('beta/deep/placeholder.twig');
    const realpath = jest.spyOn(fs, 'realpathSync');

    expect(resolveReference('@components/missing')).toBeNull();
    expect(
      realpath.mock.calls.filter(([target]) => target === root),
    ).toHaveLength(2);
  });

  it('rejects escaping lexical paths and symlink candidates before a contained match', () => {
    const outside = path.join(project, 'outside.twig');
    fs.writeFileSync(outside, '<p>Outside component root</p>');
    fs.mkdirSync(path.join(root, 'alpha'));
    fs.symlinkSync(outside, path.join(root, 'alpha/card.twig'));
    const winner = write('beta/card.twig');

    expect(resolveReference('@components/../outside.twig')).toBeNull();
    expect(resolveReference()).toBe(winner);
  });

  it('reuses directory discovery until the caller clears it and still checks file existence', () => {
    write('alpha/placeholder.twig');
    const readDirectories = jest.spyOn(fs, 'readdirSync');
    expect(resolveReference()).toBeNull();
    const initialReads = readDirectories.mock.calls.length;
    const winner = write('beta/card.twig');

    expect(resolveReference()).toBeNull();
    expect(readDirectories).toHaveBeenCalledTimes(initialReads);
    cache.clear();
    expect(resolveReference()).toBe(winner);
    expect(readDirectories.mock.calls.length).toBeGreaterThan(initialReads);
    fs.unlinkSync(winner);
    expect(resolveReference()).toBeNull();
  });
});
