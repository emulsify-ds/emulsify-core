/**
 * @file Tests for the Emulsify component inspector.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  formatComponentReport,
  inspectComponents,
  runCli as runInspectComponentsCli,
} from './inspect-components.js';

const makeTempProject = () =>
  mkdtempSync(join(tmpdir(), 'emulsify-component-inspector-'));

function writeProjectFile(projectDir, relPath, contents = '') {
  const filePath = join(projectDir, relPath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
  return filePath;
}

function writeProjectConfig(projectDir, project, variant) {
  writeProjectFile(
    projectDir,
    'project.emulsify.json',
    JSON.stringify(
      {
        project,
        ...(variant ? { variant } : {}),
      },
      null,
      2,
    ),
  );
}

describe('inspect-components', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('reports portable references and dist paths for a platform-neutral project', () => {
    writeProjectConfig(projectDir, {
      platform: 'none',
      machineName: 'example',
    });
    writeProjectFile(
      projectDir,
      'src/components/card/card.twig',
      '<article>Card</article>',
    );
    writeProjectFile(
      projectDir,
      'src/components/card/_content.twig',
      '<p>Partial</p>',
    );
    writeProjectFile(
      projectDir,
      'src/layout/grid/grid.html.twig',
      '<div>Grid</div>',
    );

    expect(inspectComponents({ projectDir, env: {} })).toEqual({
      project: {
        machineName: 'example',
        namespaceRoots: {
          components: './src/components',
          layout: './src/layout',
        },
        platform: 'none',
        singleDirectoryComponents: false,
      },
      components: [
        {
          label: 'Card',
          name: 'card',
          namespaces: ['@components/card/card.twig', 'example:card'],
          namespaceCollisionCount: 1,
          location: './dist/components/card',
          source: './src/components/card',
        },
        {
          label: 'Grid',
          name: 'grid',
          namespaces: ['@layout/grid/grid.html.twig'],
          namespaceCollisionCount: 0,
          location: './dist/global/layout/grid',
          source: './src/layout/grid',
        },
      ],
    });
  });

  it('reports mirrored component locations only for Drupal SDC output', () => {
    writeProjectConfig(projectDir, {
      platform: 'drupal',
      machineName: 'theme',
      singleDirectoryComponents: true,
    });
    writeProjectFile(
      projectDir,
      'src/components/card/card.twig',
      '<article>Card</article>',
    );

    const report = inspectComponents({ projectDir, env: {} });

    expect(report.project).toMatchObject({
      platform: 'drupal',
      singleDirectoryComponents: true,
    });
    expect(report.components[0]).toMatchObject({
      location: './components/card',
      source: './src/components/card',
    });
  });

  it('supports root components and projects without a machine name', () => {
    writeProjectConfig(projectDir, {
      platform: 'wordpress',
    });
    writeProjectFile(
      projectDir,
      'components/banner/banner.twig',
      '<aside>Banner</aside>',
    );

    expect(inspectComponents({ projectDir, env: {} })).toMatchObject({
      project: {
        machineName: null,
        platform: 'wordpress',
      },
      components: [
        {
          name: 'banner',
          namespaces: ['@components/banner/banner.twig'],
          location: './dist/components/banner',
          source: './components/banner',
        },
      ],
    });
  });

  it('returns an empty report for a non-Twig project without requiring Drupal config', () => {
    writeProjectFile(
      projectDir,
      'src/components/card/card.jsx',
      'export function Card() { return null; }',
    );

    expect(inspectComponents({ projectDir, env: {} })).toEqual({
      project: {
        machineName: null,
        namespaceRoots: {
          components: './src/components',
        },
        platform: 'none',
        singleDirectoryComponents: false,
      },
      components: [],
    });
  });

  it('respects named structure implementations and keeps alias collisions visible after filtering', () => {
    writeProjectConfig(
      projectDir,
      {
        platform: 'none',
        machineName: 'library',
      },
      {
        structureImplementations: [
          { name: 'components', directory: './src/components/' },
          { name: 'foundation', directory: './src/foundation/' },
        ],
      },
    );
    writeProjectFile(
      projectDir,
      'src/components/alpha/button.twig',
      '<button>Alpha</button>',
    );
    writeProjectFile(
      projectDir,
      'src/components/beta/button.twig',
      '<button>Beta</button>',
    );
    writeProjectFile(
      projectDir,
      'src/foundation/colors/colors.twig',
      '<span>Blue</span>',
    );

    const fullReport = inspectComponents({ projectDir, env: {} });
    const filteredReport = inspectComponents({
      projectDir,
      env: {},
      filters: ['button', 'alpha'],
    });

    expect(fullReport.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'colors',
          namespaces: ['@foundation/colors/colors.twig'],
          location: './dist/foundation/colors',
        }),
      ]),
    );
    expect(filteredReport.components).toEqual([
      expect.objectContaining({
        name: 'button',
        namespaces: ['@components/alpha/button.twig', 'library:button'],
        namespaceCollisionCount: 2,
        source: './src/components/alpha',
      }),
    ]);
    expect(formatComponentReport(fullReport)).toContain(
      'library:button (ambiguous: 2 templates)',
    );
  });

  it('prints JSON and supports positional and explicit filters', () => {
    writeProjectConfig(projectDir, {
      platform: 'none',
      machineName: 'example',
    });
    writeProjectFile(
      projectDir,
      'src/components/card/card.twig',
      '<article>Card</article>',
    );
    writeProjectFile(
      projectDir,
      'src/components/button/button.twig',
      '<button>Button</button>',
    );
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    expect(
      runInspectComponentsCli([
        '--root',
        projectDir,
        '--json',
        'component',
        '--filter',
        'card',
      ]),
    ).toBe(0);

    const report = JSON.parse(logSpy.mock.calls[0][0]);
    expect(report.components).toHaveLength(1);
    expect(report.components[0].name).toBe('card');
  });

  it('emits parseable JSON errors without writing stderr', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(runInspectComponentsCli(['--json', '--unknown'])).toBe(2);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(JSON.parse(logSpy.mock.calls[0][0])).toEqual({
      error: {
        code: 'invalid-arguments',
        message: 'Unknown option: --unknown',
      },
    });
  });

  it('fails clearly when the selected project root is not a directory', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const missingRoot = join(projectDir, 'missing');

    expect(runInspectComponentsCli(['--root', missingRoot, '--json'])).toBe(2);
    expect(JSON.parse(logSpy.mock.calls[0][0])).toEqual({
      error: {
        code: 'inspection-failed',
        message: `Project root is not a readable directory: ${missingRoot}`,
      },
    });
  });
});
