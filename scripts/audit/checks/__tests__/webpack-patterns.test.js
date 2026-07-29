/**
 * @file Tests for the Webpack pattern audit check.
 */

import { auditWebpackPatterns } from '../webpack-patterns.js';
import { resetFileReadCache } from '../../lib/files.js';
import {
  makeTempProject,
  removeTempProject,
  writeFile,
} from '../../test-utils.js';

describe('auditWebpackPatterns', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
    resetFileReadCache();
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  it('reports Webpack-era code patterns', () => {
    const codeFile = writeFile(
      projectDir,
      'src/components/card/card.stories.js',
      'require.context("./", true, /stories/);',
    );

    const findings = auditWebpackPatterns({
      codeFiles: [codeFile],
      projectDir,
    });

    expect(findings[0]).toMatchObject({
      id: 'webpack-era-pattern',
      line: 1,
    });
  });
});
