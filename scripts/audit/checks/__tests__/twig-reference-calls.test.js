/**
 * @file Filesystem integration coverage for grouped Twig reference calls.
 */

import fs from 'node:fs';
import { join } from 'node:path';
import { resolveProjectConfig } from '../../../../config/vite/project-config.js';
import { auditTwigReferences } from '../twig-references.js';
import { resetFileReadCache } from '../../lib/files.js';
import {
  makeTempProject,
  removeTempProject,
  writeFile,
} from '../../test-utils.js';

describe('Twig reference calls with filesystem resolution', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
    resetFileReadCache();
    writeFile(
      projectDir,
      'project.emulsify.json',
      JSON.stringify({
        project: {
          platform: 'drupal',
          machineName: 'test_theme',
          singleDirectoryComponents: true,
        },
      }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetFileReadCache();
    removeTempProject(projectDir);
  });

  const contextFor = (twigFiles) => ({
    env: resolveProjectConfig(projectDir, {}),
    projectDir,
    twigFiles,
  });

  it('shares one grouped directory traversal across fallback calls and files', () => {
    writeFile(
      projectDir,
      'src/components/navigation/footer/footer.twig',
      '<footer>Footer</footer>',
    );
    writeFile(
      projectDir,
      'src/components/forms/search/search.twig',
      '<form>Search</form>',
    );
    const firstFile = writeFile(
      projectDir,
      'src/components/probes/first.twig',
      [
        '{{ include(["test_theme:missing-one", "test_theme:footer"]) }}',
        '{{ include(["test_theme:missing-two", "test_theme:search"]) }}',
      ].join('\n'),
    );
    const secondFile = writeFile(
      projectDir,
      'src/components/probes/second.twig',
      [
        '{{ include(["test_theme:missing-three", "test_theme:search"]) }}',
        '{{ include(["test_theme:missing-four", "test_theme:footer"]) }}',
      ].join('\n'),
    );
    const context = contextFor([firstFile, secondFile]);
    const readDirectories = jest.spyOn(fs, 'readdirSync');

    expect(auditTwigReferences(context)).toEqual([]);

    const visited = readDirectories.mock.calls.map(([directory]) => directory);
    expect(visited).toEqual(
      expect.arrayContaining([
        join(projectDir, 'src/components'),
        join(projectDir, 'src/components/navigation/footer'),
        join(projectDir, 'src/components/forms/search'),
      ]),
    );
    expect(new Set(visited).size).toBe(visited.length);
  });

  it('refreshes grouped directories on the next audit after a component is added', () => {
    const twigFile = writeFile(
      projectDir,
      'src/components/probes/new-component.twig',
      '{{ include(["test_theme:missing", "test_theme:added"]) }}',
    );
    const context = contextFor([twigFile]);
    const readDirectories = jest.spyOn(fs, 'readdirSync');
    const findings = auditTwigReferences(context);

    expect(findings).toEqual([
      expect.objectContaining({
        id: 'unresolved-twig-reference',
        filePath: twigFile,
        line: 1,
      }),
    ]);

    const addedDirectory = 'src/components/navigation/new-group/added';
    writeFile(
      projectDir,
      `${addedDirectory}/added.twig`,
      '<p>Added between audits</p>',
    );
    resetFileReadCache();

    expect(auditTwigReferences(context)).toEqual([]);
    const visited = readDirectories.mock.calls.map(([directory]) => directory);
    expect(
      visited.filter(
        (directory) => directory === join(projectDir, 'src/components'),
      ),
    ).toHaveLength(2);
    expect(visited).toContain(join(projectDir, addedDirectory));
  });

  it('rejects an escaping grouped symlink but accepts a valid later fallback', () => {
    const outsideFile = writeFile(
      projectDir,
      'outside-components/escaped.twig',
      '<p>Outside the components root</p>',
    );
    const linkedDirectory = join(
      projectDir,
      'src/components/navigation/escaped',
    );
    fs.mkdirSync(linkedDirectory, { recursive: true });
    const linkedFile = join(linkedDirectory, 'escaped.twig');
    fs.symlinkSync(outsideFile, linkedFile);
    writeFile(
      projectDir,
      'src/components/forms/safe/safe.twig',
      '<p>Safe fallback</p>',
    );
    const onlyEscaping = writeFile(
      projectDir,
      'src/components/probes/only-escaping.twig',
      '{{ include(["test_theme:escaped"]) }}',
    );
    const validFallback = writeFile(
      projectDir,
      'src/components/probes/valid-fallback.twig',
      '{{ include(["test_theme:escaped", "test_theme:safe"]) }}',
    );

    expect(fs.realpathSync(linkedFile)).toBe(fs.realpathSync(outsideFile));
    expect(
      auditTwigReferences(contextFor([onlyEscaping, validFallback])),
    ).toEqual([
      expect.objectContaining({
        id: 'unresolved-twig-reference',
        severity: 'warn',
        filePath: onlyEscaping,
        line: 1,
        message: expect.stringContaining('test_theme:escaped'),
      }),
    ]);
  });

  it('resolves identical relative fallback references from each importing directory', () => {
    const source = '{{ include(["./missing.twig", "./shared.twig"]) }}';
    const firstFile = writeFile(
      projectDir,
      'src/components/first/importer.twig',
      source,
    );
    const secondFile = writeFile(
      projectDir,
      'src/components/second/importer.twig',
      source,
    );
    writeFile(
      projectDir,
      'src/components/first/shared.twig',
      '<p>Only the first importer has this fallback</p>',
    );

    expect(auditTwigReferences(contextFor([firstFile, secondFile]))).toEqual([
      expect.objectContaining({
        id: 'unresolved-twig-reference',
        severity: 'warn',
        filePath: secondFile,
        line: 1,
        message: expect.stringContaining('./shared.twig'),
      }),
    ]);
  });
});
