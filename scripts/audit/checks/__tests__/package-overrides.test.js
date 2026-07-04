/**
 * @file Tests for the package override audit check.
 */

import { auditPackageOverrides } from '../package-overrides.js';
import {
  makeTempProject,
  removeTempProject,
  writeFile,
} from '../../test-utils.js';

describe('auditPackageOverrides', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  it('reports missing recommended package overrides for Core consumers', () => {
    writeFile(
      projectDir,
      'package.json',
      JSON.stringify({
        name: 'consumer-theme',
        dependencies: {
          '@emulsify/core': '^4.0.0',
        },
      }),
    );

    const finding = auditPackageOverrides({ projectDir })[0];

    expect(finding.details).toEqual([
      'Add overrides.glob: ^13.0.6.',
      'Add overrides.locutus: ^3.0.36.',
      'Add overrides.minimatch@3.0.x: ^3.1.5.',
    ]);
  });

  it('accepts recommended package overrides for Core consumers', () => {
    writeFile(
      projectDir,
      'package.json',
      JSON.stringify({
        name: 'consumer-theme',
        dependencies: {
          '@emulsify/core': '^4.0.0',
        },
        overrides: {
          glob: '^13.0.6',
          locutus: '^3.0.36',
          'minimatch@3.0.x': '^3.1.5',
        },
      }),
    );

    expect(auditPackageOverrides({ projectDir })).toEqual([]);
  });
});
