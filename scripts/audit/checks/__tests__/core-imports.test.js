/**
 * @file Tests for the Core import audit check.
 */

import { auditCoreImports } from '../core-imports.js';
import { resetFileReadCache } from '../../lib/files.js';
import {
  makeTempProject,
  removeTempProject,
  writeFile,
} from '../../test-utils.js';

describe('auditCoreImports', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
    resetFileReadCache();
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  it('reports direct imports of Emulsify Core internals', () => {
    const codeFile = writeFile(
      projectDir,
      'src/components/card/card.stories.js',
      'import { renderTwig } from "@emulsify/core/src/storybook/render-twig.js";',
    );

    const findings = auditCoreImports({ codeFiles: [codeFile] });

    expect(findings[0]).toMatchObject({
      id: 'internal-core-import',
      line: 1,
    });
  });
});
