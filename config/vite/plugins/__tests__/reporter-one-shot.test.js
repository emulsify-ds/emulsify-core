/**
 * @file Tests for one-shot build asset reporting and strict mode.
 *
 * A one-shot `vite build` used to print one raw Vite line per unresolved CSS
 * asset URL and exit 0, so a broken asset path shipped through CI unnoticed.
 * These pin both halves of the fix: the report, and the opt-in failure.
 */

import { createDiagnosticsCollector } from '../reporter/diagnostics.js';
import { developReporterPlugin } from '../reporter/index.js';
import {
  STRICTNESS,
  countStrictAssetFailures,
  resolveAssetStrictness,
} from '../reporter/strict-mode.js';

/**
 * Build a one-shot reporter harness with captured output.
 *
 * @param {{strictness?: string}} [options] - Plugin overrides.
 * @returns {{plugin: object, lines: string[], collector: object}} Harness.
 */
function createOneShotHarness({ strictness = STRICTNESS.off } = {}) {
  const lines = [];
  const collector = createDiagnosticsCollector();

  const plugin = developReporterPlugin({
    env: { projectDir: '/project', platform: 'none' },
    diagnostics: collector,
    write: (line) => lines.push(line),
    colorEnabled: false,
    unicodeEnabled: true,
    strictness,
    version: '4.2.1',
  });

  plugin.configResolved({ build: { watch: null, outDir: 'dist/' } });

  return { plugin, lines, collector };
}

describe('one-shot asset reporting', () => {
  it('prints nothing when the build had no asset problems', () => {
    // The invariant every release fixture and `npm run build` depends on: a
    // clean project's output stays byte for byte what it was.
    const { plugin, lines } = createOneShotHarness();

    plugin.buildStart();
    plugin.writeBundle();
    plugin.closeBundle();

    expect(lines).toEqual([]);
  });

  it('reports repaired URLs with the command that makes them permanent', () => {
    const { plugin, lines, collector } = createOneShotHarness();

    collector.recordAssetRebase({
      url: '../../assets/images/x.svg',
      rewritten: '/assets/images/x.svg',
      importer: '/project/src/components/card/card.scss',
      resolvedAsset: '/project/assets/images/x.svg',
    });
    plugin.writeBundle();
    plugin.closeBundle();

    const output = lines.join('\n');

    expect(output).toContain('1 css asset url rebased');
    expect(output).toContain(
      '../../assets/images/x.svg -> /assets/images/x.svg',
    );
    expect(output).toContain('emulsify-audit --fix');
  });

  it('subtracts repaired URLs from the unresolved list', () => {
    // Vite warns about a URL before the rebase plugin repairs it, so without
    // the subtraction the summary reports a problem that no longer exists.
    const { plugin, lines, collector } = createOneShotHarness();

    collector.recordUnresolvedAsset({ url: '../../assets/images/x.svg' });
    collector.recordAssetRebase({
      url: '../../assets/images/x.svg',
      rewritten: '/assets/images/x.svg',
    });
    plugin.closeBundle();

    expect(lines.join('\n')).not.toContain('unresolved css url');
  });

  it('names an ambiguous URL rather than guessing at it', () => {
    const { plugin, lines, collector } = createOneShotHarness();

    collector.recordAssetRebase({
      status: 'ambiguous',
      url: 'assets/icons/dupe.svg',
      candidates: [
        '/project/assets/icons/dupe.svg',
        '/project/src/assets/icons/dupe.svg',
      ],
    });
    plugin.closeBundle();

    expect(lines.join('\n')).toContain('matches more than one asset root');
  });

  it('reports only once across writeBundle and closeBundle', () => {
    const { plugin, lines, collector } = createOneShotHarness();

    collector.recordAssetRebase({
      url: 'assets/x.svg',
      rewritten: '/assets/x.svg',
    });
    plugin.writeBundle();
    plugin.closeBundle();
    plugin.closeBundle();

    expect(
      lines.filter((line) => line.includes('rebased to /assets/')),
    ).toHaveLength(1);
  });
});

describe('strict asset mode', () => {
  it.each([
    [{}, STRICTNESS.off],
    [{ EMULSIFY_STRICT_ASSETS: '' }, STRICTNESS.off],
    [{ EMULSIFY_STRICT_ASSETS: '0' }, STRICTNESS.off],
    [{ EMULSIFY_STRICT_ASSETS: 'false' }, STRICTNESS.off],
    [{ EMULSIFY_STRICT_ASSETS: '1' }, STRICTNESS.unresolved],
    [{ EMULSIFY_STRICT_ASSETS: '2' }, STRICTNESS.all],
    // npm claims some flag names for itself, so the bridge verbosity.js
    // documents is honored here too.
    [{ npm_config_strict_assets: 'true' }, STRICTNESS.unresolved],
  ])('resolves %j to %s', (env, expected) => {
    expect(resolveAssetStrictness(env)).toBe(expected);
  });

  it.each([
    [STRICTNESS.off, 0],
    [STRICTNESS.unresolved, 1],
    [STRICTNESS.all, 2],
  ])('counts failures at %s as %i', (strictness, expected) => {
    const snapshot = {
      unresolvedAssets: [{ url: 'a' }],
      assetRebases: [{ url: 'b', status: 'rebased' }],
    };

    expect(countStrictAssetFailures(snapshot, strictness)).toBe(expected);
  });

  it('fails the build when an asset URL cannot be resolved', () => {
    // Thrown rather than set on process.exitCode: `storybook build` ends with
    // process.exit(0) in a commander postAction hook, which discards it.
    const { plugin, collector } = createOneShotHarness({
      strictness: STRICTNESS.unresolved,
    });

    collector.recordUnresolvedAsset({ url: './missing.svg' });

    expect(() => plugin.closeBundle()).toThrow(/did not resolve/);
  });

  it('does not fail on a repaired URL unless strictness is raised', () => {
    const repaired = () => {
      const harness = createOneShotHarness({
        strictness: STRICTNESS.unresolved,
      });
      harness.collector.recordAssetRebase({
        url: 'assets/x.svg',
        rewritten: '/assets/x.svg',
      });
      return harness;
    };

    expect(() => repaired().plugin.closeBundle()).not.toThrow();

    const strict = createOneShotHarness({ strictness: STRICTNESS.all });
    strict.collector.recordAssetRebase({
      url: 'assets/x.svg',
      rewritten: '/assets/x.svg',
    });

    expect(() => strict.plugin.closeBundle()).toThrow(/did not resolve/);
  });

  it('never fails a watch build', () => {
    // The develop loop reports and keeps going; failing it would end the watch.
    const lines = [];
    const collector = createDiagnosticsCollector();
    const plugin = developReporterPlugin({
      env: { projectDir: '/project', platform: 'none' },
      diagnostics: collector,
      write: (line) => lines.push(line),
      colorEnabled: false,
      strictness: STRICTNESS.all,
      version: '4.2.1',
    });

    plugin.configResolved({ build: { watch: {}, outDir: 'dist/' } });
    plugin.buildStart();
    collector.recordUnresolvedAsset({ url: './missing.svg' });

    expect(() => plugin.closeBundle()).not.toThrow();
  });
});
