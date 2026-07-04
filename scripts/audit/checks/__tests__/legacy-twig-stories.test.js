/**
 * @file Tests for the legacy Twig story audit check.
 */

import { auditLegacyTwigStories } from '../legacy-twig-stories.js';
import { resetFileReadCache } from '../../lib/files.js';
import {
  makeTempProject,
  removeTempProject,
  writeFile,
} from '../../test-utils.js';

describe('auditLegacyTwigStories', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
    resetFileReadCache();
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  it('reports stories that return imported Twig templates directly', () => {
    const storyFile = writeFile(
      projectDir,
      'src/components/card/card.stories.js',
      [
        'import cardTwig from "./card.twig";',
        'export const Card = (args) => cardTwig(args);',
      ].join('\n'),
    );

    const findings = auditLegacyTwigStories({ storyFiles: [storyFile] });

    expect(findings[0]).toMatchObject({
      id: 'legacy-twig-story',
      filePath: storyFile,
      line: 2,
    });
  });
});
