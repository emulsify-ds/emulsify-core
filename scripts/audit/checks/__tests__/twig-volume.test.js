/**
 * @file Tests for the Twig volume audit check.
 */

import { join } from 'node:path';
import { auditTwigVolume } from '../twig-volume.js';
import {
  makeTempProject,
  removeTempProject,
  writeFile,
} from '../../test-utils.js';

describe('auditTwigVolume', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  it('reports Twig roots above the configured threshold', () => {
    writeFile(
      projectDir,
      'src/components/card/card.twig',
      '<article></article>',
    );
    writeFile(projectDir, 'src/components/card/_content.twig', '<p></p>');

    const findings = auditTwigVolume({
      env: {
        projectStructure: {
          twigRoots: [join(projectDir, 'src')],
        },
      },
      twigThreshold: 1,
    });

    expect(findings[0]).toMatchObject({
      id: 'large-twig-storybook-roots',
      severity: 'info',
    });
  });
});
