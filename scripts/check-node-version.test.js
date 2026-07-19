/**
 * @file Tests for the package-derived Node.js runtime policy.
 */

import { readFileSync } from 'node:fs';
import {
  assertNodeVersionSupported,
  compareNodeVersions,
  formatNodeVersionFailure,
  isNodeVersionSupported,
  parseMinimumNodeEngine,
  parseNodeVersion,
  SUPPORTED_NODE_ENGINE,
} from './check-node-version.js';

const readJson = (relativePath) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));

describe('Node.js runtime policy', () => {
  it('derives the supported engine from package.json', () => {
    const rootPackage = readJson('../package.json');
    expect(SUPPORTED_NODE_ENGINE).toBe(rootPackage.engines.node);
  });

  it('covers the strictest direct published toolchain dependency', () => {
    const rootPackage = readJson('../package.json');
    const { minimumVersion } = parseMinimumNodeEngine(SUPPORTED_NODE_ENGINE);
    const packageName = 'stylelint-selector-bem-pattern';

    expect(rootPackage.dependencies).toHaveProperty(packageName);

    const dependencyPackage = readJson(
      `../node_modules/${packageName}/package.json`,
    );
    const dependencyMinimum = parseMinimumNodeEngine(
      dependencyPackage.engines.node,
    ).minimumVersion;

    expect(compareNodeVersions(minimumVersion, dependencyMinimum)).not.toBe(-1);
  });

  it('rejects a version below the supported minimum', () => {
    expect(isNodeVersionSupported('24.12.99')).toBe(false);
    expect(() => assertNodeVersionSupported('24.12.99')).toThrow(
      formatNodeVersionFailure('24.12.99'),
    );
  });

  it.each(['24.13.0', '24.13.1', '24.14.0', '25.0.0'])(
    'accepts the exact minimum and later patch, minor, or major version: %s',
    (version) => {
      expect(isNodeVersionSupported(version)).toBe(true);
      expect(() => assertNodeVersionSupported(version)).not.toThrow();
    },
  );

  it('compares semantic version parts numerically', () => {
    expect(compareNodeVersions('24.12.99', '24.13.0')).toBe(-1);
    expect(compareNodeVersions('24.13.0', '24.13.0')).toBe(0);
    expect(compareNodeVersions('25.0.0', '24.13.0')).toBe(1);
    expect(parseNodeVersion('24.13.0')).toEqual([24, 13, 0]);
  });

  it('parses only a single inclusive minimum engine expression', () => {
    expect(parseMinimumNodeEngine('>=20')).toEqual({
      minimumVersion: '20.0.0',
      parts: [20, 0, 0],
    });
    expect(parseMinimumNodeEngine('>=20.1')).toEqual({
      minimumVersion: '20.1.0',
      parts: [20, 1, 0],
    });
    expect(parseMinimumNodeEngine('>=20.1.2')).toEqual({
      minimumVersion: '20.1.2',
      parts: [20, 1, 2],
    });
  });

  it.each([
    '',
    '24.13.0',
    '^24.13.0',
    '>=24.x',
    '>=24.13.0 <25',
    '>=24.13.0 || >=25',
  ])('rejects malformed or unsupported engine expression: %s', (engine) => {
    expect(() => parseMinimumNodeEngine(engine)).toThrow(
      /Unsupported package\.json engines\.node expression/,
    );
  });

  it('reports both the required and current versions', () => {
    const message = formatNodeVersionFailure('24.12.99');

    expect(message).toContain('requires Node.js 24.13.0 or later');
    expect(message).toContain('package.json engines.node: ">=24.13.0"');
    expect(message).toContain('Current version: 24.12.99');
  });
});
