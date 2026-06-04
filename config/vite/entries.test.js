/**
 * @file Tests for Vite/Rollup entry key generation.
 */

import { mkdtempSync, rmSync } from 'fs';
import { join, relative, sep } from 'path';
import { tmpdir } from 'os';
import { buildInputs } from './entries.js';
import { resolveProjectStructure, relativeFrom } from './project-structure.js';
import { toPosixPath } from './utils/paths.js';

const makeTempProject = () => mkdtempSync(join(tmpdir(), 'emulsify-core-'));

const sourceEntry = (absPath, rootType, roots) => {
  const root =
    roots.find((candidate) => {
      const rel = relative(candidate.directory, absPath);
      return rel && !rel.startsWith('..') && !rel.includes(`..${sep}`);
    }) || roots[0];

  return {
    absPath,
    relPath: root ? relativeFrom(absPath, root.directory) : absPath,
    root,
    rootType,
  };
};

const fakeSourceFileIndex = ({ componentFiles = [], globalFiles = [] }) => ({
  all: () => [...componentFiles, ...globalFiles],
  componentFiles: () => componentFiles,
  globalFiles: () => globalFiles,
});

const jsxExclusionEntryPaths = [
  'src/components/card/Card.jsx',
  'src/components/card/Card.stories.jsx',
  'src/components/card/Card.component.jsx',
  'src/components/card/Card.min.jsx',
  'src/components/card/Card.test.jsx',
];

const buildContext = (
  projectDir,
  {
    platform = 'generic',
    SDC = false,
    srcExists = true,
    structureImplementations = [],
    componentFilePaths = [],
    globalFilePaths = [],
  } = {},
) => {
  const srcDir = srcExists
    ? join(projectDir, 'src')
    : join(projectDir, 'components');
  const absoluteStructureImplementations = structureImplementations.map(
    (implementation) => ({
      ...implementation,
      directory: join(projectDir, implementation.directory),
    }),
  );
  const structure = resolveProjectStructure({
    projectDir,
    srcDir,
    srcExists,
    SDC,
    structureImplementations: absoluteStructureImplementations,
  });
  const componentFiles = componentFilePaths.map((relPath) =>
    sourceEntry(
      join(projectDir, relPath),
      'component',
      structure.componentRootRecords,
    ),
  );
  const globalFiles = globalFilePaths.map((relPath) =>
    sourceEntry(
      join(projectDir, relPath),
      'global',
      structure.globalRootRecords,
    ),
  );

  return {
    projectDir,
    srcDir,
    srcExists,
    isDrupal: platform === 'drupal',
    SDC,
    structureOverrides: structure.structureOverrides,
    structureRoots: absoluteStructureImplementations.map(
      (implementation) => implementation.directory,
    ),
    structureImplementations: absoluteStructureImplementations,
    projectStructure: structure,
    sourceFileIndex: fakeSourceFileIndex({ componentFiles, globalFiles }),
  };
};

const buildRelativeInputs = (ctx) => {
  const inputs = buildInputs(ctx);

  return Object.fromEntries(
    Object.entries(inputs)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [
        key,
        toPosixPath(relative(ctx.projectDir, value)),
      ]),
  );
};

describe('buildInputs structure outputs', () => {
  let projectDir;

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('preserves Drupal SDC output for src/components projects', () => {
    projectDir = makeTempProject();
    const ctx = buildContext(projectDir, {
      platform: 'drupal',
      SDC: true,
      componentFilePaths: [
        'src/components/card/card.js',
        'src/components/card/card.scss',
      ],
    });

    expect(buildRelativeInputs(ctx)).toMatchInlineSnapshot(`
{
  "components/card/card": "src/components/card/card.js",
  "components/card/card__style": "src/components/card/card.scss",
}
`);
  });

  it('preserves generic output for src/components projects', () => {
    projectDir = makeTempProject();
    const ctx = buildContext(projectDir, {
      componentFilePaths: [
        'src/components/card/card.js',
        'src/components/card/card.scss',
        'src/components/card/_partial.scss',
        'src/components/card/card.stories.js',
        'src/components/card/card.component.js',
        'src/components/card/card.min.js',
        'src/components/card/card.test.js',
        'src/components/card/cl-card.scss',
      ],
      globalFilePaths: ['src/base/base.js', 'src/base/base.scss'],
    });

    expect(buildRelativeInputs(ctx)).toMatchInlineSnapshot(`
{
  "components/card/css/card": "src/components/card/card.scss",
  "components/card/js/card": "src/components/card/card.js",
  "global/base/css/base": "src/base/base.scss",
  "global/base/js/base": "src/base/base.js",
  "storybook/components/card/cl-card": "src/components/card/cl-card.scss",
}
`);
  });

  it('builds JSX component entries with JS output keys for generic projects', () => {
    projectDir = makeTempProject();
    const ctx = buildContext(projectDir, {
      componentFilePaths: ['src/components/card/Card.jsx'],
    });

    expect(buildRelativeInputs(ctx)).toMatchInlineSnapshot(`
{
  "components/card/js/Card": "src/components/card/Card.jsx",
}
`);
  });

  it('builds JSX component entries with Drupal SDC output keys', () => {
    projectDir = makeTempProject();
    const ctx = buildContext(projectDir, {
      platform: 'drupal',
      SDC: true,
      componentFilePaths: ['src/components/card/Card.jsx'],
    });

    expect(buildRelativeInputs(ctx)).toMatchInlineSnapshot(`
{
  "components/card/Card": "src/components/card/Card.jsx",
}
`);
  });

  it('excludes JSX story, component, minified, and test files', () => {
    projectDir = makeTempProject();
    const ctx = buildContext(projectDir, {
      componentFilePaths: jsxExclusionEntryPaths,
    });

    expect(buildRelativeInputs(ctx)).toMatchInlineSnapshot(`
{
  "components/card/js/Card": "src/components/card/Card.jsx",
}
`);
  });

  it('supports canonical root components-only projects', () => {
    projectDir = makeTempProject();
    const ctx = buildContext(projectDir, {
      srcExists: false,
      componentFilePaths: [
        'components/card/card.js',
        'components/card/card.scss',
        'components/card/sb-card.scss',
      ],
    });

    expect(buildRelativeInputs(ctx)).toMatchInlineSnapshot(`
{
  "components/card/css/card": "components/card/card.scss",
  "components/card/js/card": "components/card/card.js",
  "storybook/card/sb-card": "components/card/sb-card.scss",
}
`);
  });

  it('preserves structureImplementation entry output paths', () => {
    projectDir = makeTempProject();
    const ctx = buildContext(projectDir, {
      platform: 'drupal',
      structureImplementations: [
        { name: 'components', directory: 'src/components' },
        { name: 'foundation', directory: 'src/foundation' },
        { name: 'layout', directory: 'src/layout' },
        { name: 'tokens', directory: 'src/tokens' },
      ],
      componentFilePaths: [
        'src/components/button/button.js',
        'src/components/button/button.scss',
        'src/components/button/cl-button.scss',
        'src/foundation/colors/colors.js',
        'src/foundation/colors/colors.scss',
        'src/layout/grid/sb-grid.scss',
      ],
    });

    expect(buildRelativeInputs(ctx)).toMatchInlineSnapshot(`
{
  "css/button/button": "src/components/button/button.scss",
  "css/src/foundation/colors/colors": "src/foundation/colors/colors.scss",
  "js/button/button": "src/components/button/button.js",
  "js/src/foundation/colors/colors": "src/foundation/colors/colors.js",
  "storybook/src/components/button/cl-button": "src/components/button/cl-button.scss",
  "storybook/src/layout/grid/sb-grid": "src/layout/grid/sb-grid.scss",
}
`);
  });
});
