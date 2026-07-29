/**
 * @file Tests for the Twig reference audit check.
 */

import { auditTwigReferences } from '../twig-references.js';
import { resetFileReadCache } from '../../lib/files.js';
import {
  findTwigIncludeSourceReferences,
  resolvesTwigReference,
} from '../../lib/twig.js';
import {
  makeTempProject,
  removeTempProject,
  writeFile,
} from '../../test-utils.js';

describe('auditTwigReferences', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
    resetFileReadCache();
  });

  afterEach(() => {
    removeTempProject(projectDir);
  });

  it('reports unknown namespaces and unresolved include/source references', () => {
    const twigFile = writeFile(
      projectDir,
      'src/components/card/card.twig',
      '{{ include("@missing/card.twig") }}',
    );

    const findings = auditTwigReferences({
      env: {
        projectDir,
        namespaceRoots: {},
      },
      projectDir,
      twigFiles: [twigFile],
    });

    expect(findings.map((finding) => finding.id)).toEqual([
      'unknown-twig-namespace',
      'unresolved-twig-reference',
    ]);
  });

  it('resolves source() asset references from configured asset roots', () => {
    const twigFile = writeFile(projectDir, 'src/components/icon/icon.twig');
    writeFile(projectDir, 'custom-assets/icons/foo.svg', '<svg></svg>');

    expect(
      resolvesTwigReference('@assets/icons/foo.svg', twigFile, {
        projectDir,
        projectStructure: {
          assetRoots: ['custom-assets'],
        },
      }),
    ).toBe(true);
  });

  it('only treats first include/source argument strings as template references', () => {
    expect(
      findTwigIncludeSourceReferences(
        '{{ include("@components/card/card.twig", { label: "Not a template" }) }}',
      ),
    ).toEqual([
      {
        type: 'include',
        value: '@components/card/card.twig',
        line: 1,
      },
    ]);
  });
});
