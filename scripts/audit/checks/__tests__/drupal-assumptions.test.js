/**
 * @file Tests for the Drupal assumption audit check.
 */

import { auditDrupalAssumptions } from '../drupal-assumptions.js';
import { resetFileReadCache } from '../../lib/files.js';
import {
  makeTempProject,
  removeTempProject,
  writeFile,
} from '../../test-utils.js';

describe('auditDrupalAssumptions', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
    resetFileReadCache();
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  it('reports Drupal assumptions in non-Drupal projects', () => {
    const codeFile = writeFile(
      projectDir,
      'src/components/card/card.js',
      'window.Drupal.attachBehaviors();',
    );

    const findings = auditDrupalAssumptions({
      codeFiles: [codeFile],
      env: { platform: 'none' },
    });

    expect(findings[0]).toMatchObject({
      id: 'drupal-assumption-non-drupal',
      line: 1,
    });
  });

  it('allows Drupal assumptions for Drupal projects', () => {
    expect(
      auditDrupalAssumptions({
        codeFiles: [],
        env: { platform: 'drupal' },
      }),
    ).toEqual([]);
  });
});
