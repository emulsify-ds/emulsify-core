/**
 * @file Tests for the files-outside-roots audit check.
 */

import { join } from 'node:path';
import { auditFilesOutsideRoots } from '../files-outside-roots.js';
import { makeTempProject, removeTempProject } from '../../test-utils.js';

describe('auditFilesOutsideRoots', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  it('reports component-looking Twig files outside source roots', () => {
    const twigFile = join(projectDir, 'legacy/card/card.twig');

    const findings = auditFilesOutsideRoots({
      env: {
        projectStructure: {
          sourceRoots: [join(projectDir, 'src')],
          twigRoots: [join(projectDir, 'src')],
        },
      },
      projectDir,
      twigFiles: [twigFile],
    });

    expect(findings[0]).toMatchObject({
      id: 'twig-file-outside-source-roots',
      filePath: twigFile,
    });
  });

  it('does not report conventional template override files as component source roots', () => {
    const findings = auditFilesOutsideRoots({
      env: {
        projectStructure: {
          sourceRoots: [join(projectDir, 'src')],
          twigRoots: [join(projectDir, 'src')],
        },
      },
      projectDir,
      twigFiles: [join(projectDir, 'templates/layout/page.html.twig')],
    });

    expect(findings).toEqual([]);
  });
});
