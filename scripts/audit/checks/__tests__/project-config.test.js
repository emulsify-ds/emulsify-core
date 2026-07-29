/**
 * @file Tests for the project configuration audit check.
 */

import { join } from 'node:path';
import { auditProjectConfig } from '../project-config.js';
import { makeTempProject, removeTempProject } from '../../test-utils.js';

describe('auditProjectConfig', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  it('reports missing project config and missing configured roots', () => {
    const findings = auditProjectConfig({
      configExists: false,
      env: {
        structureImplementations: [
          {
            name: 'components',
            directory: join(projectDir, 'missing-components'),
          },
        ],
      },
      projectDir,
    });

    expect(findings.map((finding) => finding.id)).toEqual([
      'missing-project-config',
      'missing-structure-implementation',
    ]);
  });

  it('reports configured asset roots that escape the project root', () => {
    const findings = auditProjectConfig({
      configExists: true,
      env: {
        ignoredAssetRoots: ['../outside-assets'],
      },
      projectDir,
    });

    expect(findings[0]).toMatchObject({
      id: 'invalid-asset-root',
      severity: 'warn',
      message:
        'Configured asset root "../outside-assets" was ignored because it resolves outside the project root.',
    });
  });
});
