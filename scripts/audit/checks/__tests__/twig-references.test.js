/**
 * @file Tests for the Twig reference audit check.
 */

import fs from 'node:fs';
import { join } from 'node:path';
import { resolveProjectConfig } from '../../../../config/vite/project-config.js';
import { resolveComponentReference } from '../../../../config/vite/utils/twig-component-resolver.js';
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
    jest.restoreAllMocks();
    removeTempProject(projectDir);
  });

  const auditReferences = (references, config = {}) => {
    const twigFile = writeFile(
      projectDir,
      'src/components/reference-probe/reference-probe.twig',
      references
        .map((reference) => `{{ include('${reference}', {}, false) }}`)
        .join('\n'),
    );
    writeFile(
      projectDir,
      'project.emulsify.json',
      JSON.stringify({
        project: {
          platform: 'drupal',
          machineName: 'naswa',
          singleDirectoryComponents: true,
        },
        ...config,
      }),
    );
    const env = resolveProjectConfig(projectDir, {});

    return {
      env,
      twigFile,
      findings: auditTwigReferences({
        env,
        projectDir,
        twigFiles: [twigFile],
      }),
    };
  };

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

  it.each([
    ['naswa:card', 'src/components/card/card.twig'],
    ['naswa:footer', 'src/components/navigation/footer/footer.twig'],
    [
      'naswa:heading',
      'src/components/atoms/typography/headings/heading/heading.twig',
    ],
    [
      '@components/navigation/footer/footer.twig',
      'src/components/navigation/footer/footer.twig',
    ],
  ])('resolves %s from %s', (reference, targetFile) => {
    writeFile(projectDir, targetFile, '<p>Component</p>');

    const { findings } = auditReferences([reference]);

    expect(findings).toEqual([]);
  });

  it('resolves all five grouped NASWA component IDs without audit warnings', () => {
    const targets = {
      'naswa:connect': 'src/components/navigation/connect/connect.twig',
      'naswa:footer': 'src/components/navigation/footer/footer.twig',
      'naswa:login': 'src/components/forms/login/login.twig',
      'naswa:search': 'src/components/forms/search/search.twig',
      'naswa:main': 'src/components/navigation/main/main.twig',
    };
    for (const targetFile of Object.values(targets)) {
      writeFile(projectDir, targetFile, '<p>Component</p>');
    }

    const { env, twigFile, findings } = auditReferences(Object.keys(targets));

    expect(findings).toEqual([]);
    const groupedRootsCache = new Map();
    for (const [reference, targetFile] of Object.entries(targets)) {
      expect(resolvesTwigReference(reference, twigFile, env)).toBe(true);
      expect(
        resolveComponentReference(
          reference,
          env.namespaceRoots,
          groupedRootsCache,
        ),
      ).toBe(join(projectDir, targetFile));
    }
  });

  it.each([
    [
      'direct component over grouped duplicates',
      [
        'src/components/alpha/footer/footer.twig',
        'src/components/footer/footer.twig',
      ],
      'src/components/footer/footer.twig',
    ],
    [
      'shallower group before a lexically earlier deep group',
      [
        'src/components/alpha/deep/footer/footer.twig',
        'src/components/beta/footer/footer.twig',
      ],
      'src/components/beta/footer/footer.twig',
    ],
    [
      'code-point group order at the same depth',
      [
        'src/components/alpha/footer/footer.twig',
        'src/components/Zeta/footer/footer.twig',
      ],
      'src/components/Zeta/footer/footer.twig',
    ],
  ])('keeps runtime precedence: %s', (description, paths, expectedPath) => {
    for (const targetFile of paths) {
      writeFile(projectDir, targetFile, '<footer>Footer</footer>');
    }
    const { env, findings } = auditReferences(['naswa:footer']);

    expect(findings).toEqual([]);
    expect(
      resolveComponentReference('naswa:footer', env.namespaceRoots, new Map()),
    ).toBe(join(projectDir, expectedPath));
  });

  it('traverses grouped directories once per audit and refreshes on the next audit', () => {
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
    const { env, twigFile } = auditReferences([]);
    const references = Array.from({ length: 20 }, () => [
      'naswa:search',
      'naswa:footer',
      'naswa:not-real',
    ]).flat();
    writeFile(
      projectDir,
      'src/components/reference-probe/reference-probe.twig',
      references.map((reference) => `{{ include('${reference}') }}`).join('\n'),
    );
    resetFileReadCache();
    const readDirectories = jest.spyOn(fs, 'readdirSync');
    const context = { env, projectDir, twigFiles: [twigFile] };

    const findings = auditTwigReferences(context);
    expect(findings).toHaveLength(20);
    expect(
      findings.every(
        ({ id, message }) =>
          id === 'unresolved-twig-reference' &&
          message.includes('naswa:not-real'),
      ),
    ).toBe(true);
    const visitedDirectories = readDirectories.mock.calls.map(([path]) => path);
    expect(visitedDirectories.length).toBeGreaterThan(0);
    expect(new Set(visitedDirectories).size).toBe(visitedDirectories.length);

    writeFile(
      projectDir,
      'src/components/navigation/new-group/not-real/not-real.twig',
      '<p>Component added between audits</p>',
    );
    expect(auditTwigReferences(context)).toEqual([]);
  });

  it('uses the configured project machine name for grouped component IDs', () => {
    writeFile(
      projectDir,
      'src/components/navigation/footer/footer.twig',
      '<footer>Footer</footer>',
    );

    const { findings } = auditReferences(['another_theme:footer'], {
      project: {
        platform: 'drupal',
        machineName: 'another_theme',
        singleDirectoryComponents: true,
      },
    });

    expect(findings).toEqual([]);
  });

  it('resolves grouped IDs below a custom components root', () => {
    const targetFile = writeFile(
      projectDir,
      'library/components/navigation/footer/footer.twig',
      '<footer>Custom-root footer</footer>',
    );

    const { env, findings } = auditReferences(['custom_theme:footer'], {
      project: {
        platform: 'drupal',
        machineName: 'custom_theme',
        singleDirectoryComponents: true,
      },
      variant: {
        structureImplementations: [
          { name: 'components', directory: 'library/components' },
        ],
      },
    });

    expect(findings).toEqual([]);
    expect(
      resolveComponentReference(
        'custom_theme:footer',
        env.namespaceRoots,
        new Map(),
      ),
    ).toBe(targetFile);
  });

  it('still reports a genuinely missing project component', () => {
    writeFile(
      projectDir,
      'src/components/navigation/not-really/not-really.twig',
      '<p>A different component</p>',
    );

    const { findings } = auditReferences(['naswa:not-real']);

    expect(findings).toEqual([
      expect.objectContaining({
        id: 'unresolved-twig-reference',
        severity: 'warn',
        line: 1,
        message: expect.stringContaining('"naswa:not-real"'),
      }),
    ]);
  });

  it('does not resolve grouped components from output outside the Twig roots', () => {
    writeFile(
      projectDir,
      'dist/components/navigation/footer/footer.twig',
      '<footer>Generated only</footer>',
    );

    const { findings } = auditReferences(['naswa:footer']);

    expect(findings).toEqual([
      expect.objectContaining({ id: 'unresolved-twig-reference' }),
    ]);
  });

  it('preserves non-SDC direct and relative references without enabling grouped IDs', () => {
    writeFile(projectDir, 'src/components/card/card.twig', '<p>Card</p>');
    writeFile(
      projectDir,
      'src/components/reference-probe/_partial.twig',
      '<p>Partial</p>',
    );
    writeFile(projectDir, 'src/components/shared.html.twig', '<p>Shared</p>');
    writeFile(
      projectDir,
      'src/components/navigation/footer/footer.twig',
      '<footer>Grouped only</footer>',
    );

    const { findings } = auditReferences(
      [
        '@components/card/card.twig',
        './_partial.twig',
        '../shared',
        'standalone:footer',
      ],
      {
        project: {
          platform: 'none',
          machineName: 'standalone',
          singleDirectoryComponents: false,
        },
      },
    );

    expect(findings).toEqual([
      expect.objectContaining({
        id: 'unresolved-twig-reference',
        severity: 'warn',
        line: 4,
        message: expect.stringContaining('"standalone:footer"'),
      }),
    ]);
  });

  it('preserves custom namespaces and configured asset roots', () => {
    writeFile(projectDir, 'library/ui/card/card.twig', '<p>Card</p>');
    writeFile(projectDir, 'custom-assets/icons/foo.svg', '<svg></svg>');
    const { env, twigFile } = auditReferences([], {
      variant: {
        structureImplementations: [{ name: 'ui', directory: 'library/ui' }],
      },
      assets: { roots: ['custom-assets'] },
    });
    writeFile(
      projectDir,
      'src/components/reference-probe/reference-probe.twig',
      [
        '{{ include("@ui/card/card.twig") }}',
        '{{ source("@assets/icons/foo.svg") }}',
      ].join('\n'),
    );
    resetFileReadCache();

    expect(
      auditTwigReferences({ env, projectDir, twigFiles: [twigFile] }),
    ).toEqual([]);
  });

  it('keeps configured non-component namespaces scoped to their own roots', () => {
    writeFile(projectDir, 'library/ui/card/card.twig', '<p>Card</p>');
    writeFile(
      projectDir,
      'library/ui/navigation/footer/footer.twig',
      '<footer>Grouped component</footer>',
    );
    writeFile(projectDir, 'library/layout/page.twig', '<main>Page</main>');

    const { env, findings } = auditReferences(['@layout/footer'], {
      variant: {
        structureImplementations: [
          { name: 'ui', directory: 'library/ui' },
          { name: 'layout', directory: 'library/layout' },
        ],
      },
    });

    expect(findings).toEqual([
      expect.objectContaining({
        id: 'unresolved-twig-reference',
        message: expect.stringContaining('"@layout/footer"'),
      }),
    ]);
    expect(
      resolveComponentReference(
        '@layout/footer',
        env.namespaceRoots,
        new Map(),
      ),
    ).toBeNull();
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

  it('audits missing static references without flagging dynamic fragments or comments', () => {
    writeFile(projectDir, 'src/components/card/card.twig', '<p>Card</p>');
    const { env, twigFile } = auditReferences([]);
    writeFile(
      projectDir,
      'src/components/reference-probe/reference-probe.twig',
      [
        '{{ include("naswa:" ~ component_name, { label: "context.twig" }) }}',
        '{{ source("@assets/" ~ icon ~ ".svg") }}',
        '{# {{ include("@ghost/commented.twig") }} {{ source("@ghost/commented.svg") }} #}',
        '{{ include("@components/card/card.twig") }}',
        '{{ include("missing-static.twig") }}',
        '{{ source("@assets/missing-static.svg") }}',
        '{{ include(["@components/card/card.twig", "missing-fallback.twig", "naswa:" ~ variant]) }}',
      ].join('\n'),
    );
    resetFileReadCache();

    const findings = auditTwigReferences({
      env,
      projectDir,
      twigFiles: [twigFile],
    });

    expect(findings).toEqual([
      expect.objectContaining({
        id: 'unresolved-twig-reference',
        severity: 'warn',
        line: 5,
        message: expect.stringContaining('"missing-static.twig"'),
      }),
      expect.objectContaining({
        id: 'unresolved-twig-reference',
        severity: 'warn',
        line: 6,
        message: expect.stringContaining('"@assets/missing-static.svg"'),
      }),
    ]);
  });
});
