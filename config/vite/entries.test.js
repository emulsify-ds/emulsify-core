/**
 * @file Tests for Vite/Rollup entry key generation.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { tmpdir } from 'os';
import { buildInputs } from './entries.js';
import { resolveProjectConfig } from './project-config.js';
import { toPosixPath } from './utils/paths.js';

const makeTempProject = () => mkdtempSync(join(tmpdir(), 'emulsify-core-'));

const writeProjectConfig = (projectDir, config) => {
  writeFileSync(
    join(projectDir, 'project.emulsify.json'),
    JSON.stringify(config, null, 2),
  );
};

const writeSourceFile = (projectDir, relPath, contents = '') => {
  const absPath = join(projectDir, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, contents);
};

const buildRelativeInputs = (projectDir) => {
  const env = resolveProjectConfig(projectDir, {});
  const inputs = buildInputs(env);

  return Object.fromEntries(
    Object.entries(inputs)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, toPosixPath(relative(projectDir, value))]),
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
    writeProjectConfig(projectDir, {
      project: {
        platform: 'drupal',
        singleDirectoryComponents: true,
      },
    });
    writeSourceFile(projectDir, 'src/components/card/card.js');
    writeSourceFile(projectDir, 'src/components/card/card.scss');

    expect(buildRelativeInputs(projectDir)).toMatchInlineSnapshot(`
{
  "components/card/card": "src/components/card/card.js",
  "components/card/card__style": "src/components/card/card.scss",
}
`);
  });

  it('preserves generic output for src/components projects', () => {
    projectDir = makeTempProject();
    writeProjectConfig(projectDir, {
      project: {
        platform: 'generic',
      },
    });
    writeSourceFile(projectDir, 'src/base/base.js');
    writeSourceFile(projectDir, 'src/base/base.scss');
    writeSourceFile(projectDir, 'src/components/card/card.js');
    writeSourceFile(projectDir, 'src/components/card/card.scss');
    writeSourceFile(projectDir, 'src/components/card/_partial.scss');
    writeSourceFile(projectDir, 'src/components/card/card.stories.js');
    writeSourceFile(projectDir, 'src/components/card/card.component.js');
    writeSourceFile(projectDir, 'src/components/card/card.min.js');
    writeSourceFile(projectDir, 'src/components/card/card.test.js');
    writeSourceFile(projectDir, 'src/components/card/cl-card.scss');

    expect(buildRelativeInputs(projectDir)).toMatchInlineSnapshot(`
{
  "components/card/css/card": "src/components/card/card.scss",
  "components/card/js/card": "src/components/card/card.js",
  "global/base/css/base": "src/base/base.scss",
  "global/base/js/base": "src/base/base.js",
  "storybook/components/card/cl-card": "src/components/card/cl-card.scss",
}
`);
  });

  it('supports canonical root components-only projects', () => {
    projectDir = makeTempProject();
    writeProjectConfig(projectDir, {
      project: {
        platform: 'generic',
      },
    });
    writeSourceFile(projectDir, 'components/card/card.js');
    writeSourceFile(projectDir, 'components/card/card.scss');
    writeSourceFile(projectDir, 'components/card/sb-card.scss');

    expect(buildRelativeInputs(projectDir)).toMatchInlineSnapshot(`
{
  "components/card/css/card": "components/card/card.scss",
  "components/card/js/card": "components/card/card.js",
  "storybook/card/sb-card": "components/card/sb-card.scss",
}
`);
  });

  it('preserves structureImplementation entry output paths', () => {
    projectDir = makeTempProject();
    writeProjectConfig(projectDir, {
      project: {
        platform: 'drupal',
      },
      variant: {
        structureImplementations: [
          { name: 'components', directory: './src/components/' },
          { name: 'foundation', directory: './src/foundation/' },
          { name: 'layout', directory: './src/layout/' },
          { name: 'tokens', directory: './src/tokens/' },
        ],
      },
    });
    writeSourceFile(projectDir, 'src/components/button/button.js');
    writeSourceFile(projectDir, 'src/components/button/button.scss');
    writeSourceFile(projectDir, 'src/components/button/cl-button.scss');
    writeSourceFile(projectDir, 'src/foundation/colors/colors.js');
    writeSourceFile(projectDir, 'src/foundation/colors/colors.scss');
    writeSourceFile(projectDir, 'src/layout/grid/sb-grid.scss');

    expect(buildRelativeInputs(projectDir)).toMatchInlineSnapshot(`
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
