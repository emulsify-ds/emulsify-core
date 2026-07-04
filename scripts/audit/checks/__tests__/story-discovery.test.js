/**
 * @file Tests for the story discovery audit check.
 */

import { join } from 'node:path';
import { auditStoryDiscovery } from '../story-discovery.js';
import {
  makeTempProject,
  removeTempProject,
  writeFile,
} from '../../test-utils.js';

describe('auditStoryDiscovery', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  it('reports stories outside discovered roots', () => {
    const storyFile = writeFile(projectDir, 'stories/outside.stories.js');

    const findings = auditStoryDiscovery({
      projectDir,
      storyFiles: [storyFile],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: 'story-outside-discovered-roots',
      filePath: join(projectDir, 'stories/outside.stories.js'),
    });
  });
});
