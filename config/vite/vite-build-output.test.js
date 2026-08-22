/**
 * @file End-to-end output policy for development and production builds.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import postcss from 'postcss';

const repoRoot = process.cwd();
const sourceFixture = join(
  repoRoot,
  '.github/fixtures/release/drupal-sdc-src-components',
);
const viteBin = join(repoRoot, 'node_modules/vite/bin/vite.js');
const viteApi = join(repoRoot, 'node_modules/vite/dist/node/index.js');
const viteConfig = join(repoRoot, 'config/vite/vite.config.js');

function linkPackage(source, target) {
  try {
    symlinkSync(source, target, 'junction');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

function linkFixturePackages(projectDir) {
  const nodeModulesDir = join(projectDir, 'node_modules');
  const scopeDir = join(nodeModulesDir, '@emulsify');
  mkdirSync(scopeDir, { recursive: true });
  linkPackage(repoRoot, join(scopeDir, 'core'));

  for (const dependency of [
    '@storybook',
    '@vitejs',
    'react',
    'react-dom',
    'storybook',
    'twig',
    'vite',
  ]) {
    linkPackage(
      join(repoRoot, 'node_modules', dependency),
      join(nodeModulesDir, dependency),
    );
  }
}

function expectSuccessfulBuild(result) {
  if (result.status === 0) return;

  throw new Error(
    [result.stdout, result.stderr, result.error]
      .filter(Boolean)
      .map(String)
      .join('\n'),
  );
}

function runProductionBuild(projectDir) {
  const result = spawnSync(
    process.execPath,
    [viteBin, 'build', '--config', viteConfig],
    {
      cwd: projectDir,
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        ...process.env,
        CI: '1',
        FORCE_COLOR: '0',
        NODE_OPTIONS: '--no-deprecation',
      },
    },
  );

  expectSuccessfulBuild(result);
}

function runDevelopmentBuild(projectDir) {
  // Resolve the exact configuration selected by `vite build --watch`, then run
  // one build through Vite's API. The CLI owns the long-lived watch loop, so
  // calling the resolved config directly exits after this deterministic cycle.
  const script = `
    process.argv = [process.execPath, 'vite', 'build', '--watch'];
    const [{ build }, { default: createConfig }] = await Promise.all([
      import(${JSON.stringify(pathToFileURL(viteApi).href)}),
      import(${JSON.stringify(pathToFileURL(viteConfig).href)}),
    ]);
    const config = await createConfig({ command: 'build' });
    await build(config);
  `;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {
      cwd: projectDir,
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        ...process.env,
        CI: '1',
        FORCE_COLOR: '0',
        NODE_OPTIONS: '--no-deprecation',
      },
    },
  );

  expectSuccessfulBuild(result);
}

const readMap = (fileName) => JSON.parse(readFileSync(fileName, 'utf8'));

const resolvedMapSources = (mapFile, sourceMap) =>
  sourceMap.sources.map((source) => resolve(dirname(mapFile), source));

describe('Vite development output', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'emulsify-vite-watch-output-'));
    cpSync(sourceFixture, projectDir, { recursive: true });
    linkFixturePackages(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('writes readable JS and correctly located JS/CSS maps only in development', () => {
    runDevelopmentBuild(projectDir);

    const componentDir = join(projectDir, 'components/card');
    const jsFile = join(componentDir, 'card.js');
    const cssFile = join(componentDir, 'card.css');
    const jsMapFile = `${jsFile}.map`;
    const cssMapFile = `${cssFile}.map`;
    const jsSource = join(projectDir, 'src/components/card/card.js');
    const scssSource = join(projectDir, 'src/components/card/card.scss');
    const scssPartial = join(
      projectDir,
      'src/components/shared/_asset-alias.scss',
    );
    const developmentJs = readFileSync(jsFile, 'utf8');
    const developmentCss = readFileSync(cssFile, 'utf8');

    expect(developmentJs.split('\n').length).toBeGreaterThan(10);
    expect(developmentJs).toContain('//# sourceMappingURL=card.js.map');
    expect(developmentCss).toContain('/*# sourceMappingURL=card.css.map */');
    expect(existsSync(jsMapFile)).toBe(true);
    expect(existsSync(cssMapFile)).toBe(true);

    const jsMap = readMap(jsMapFile);
    const cssMap = readMap(cssMapFile);
    expect(jsMap.mappings).not.toBe('');
    expect(cssMap.mappings).not.toBe('');
    expect(resolvedMapSources(jsMapFile, jsMap)).toContain(jsSource);
    expect(resolvedMapSources(cssMapFile, cssMap)).toEqual(
      expect.arrayContaining([scssSource, scssPartial]),
    );
    expect(jsMap.sourcesContent).toEqual(
      expect.arrayContaining([readFileSync(jsSource, 'utf8')]),
    );
    expect(cssMap.sourcesContent).toEqual(
      expect.arrayContaining([
        readFileSync(scssSource, 'utf8'),
        readFileSync(scssPartial, 'utf8'),
      ]),
    );

    const parsedCss = postcss.parse(developmentCss, {
      from: cssFile,
      map: { prev: cssMap },
    });
    const declarationOrigin = (selector, property) => {
      const rule = parsedCss.nodes.find(
        (node) => node.type === 'rule' && node.selector === selector,
      );
      const declaration = rule?.nodes.find(
        (node) => node.type === 'decl' && node.prop === property,
      );
      return declaration?.source?.input.origin(
        declaration.source.start.line,
        declaration.source.start.column,
      );
    };
    expect(declarationOrigin('.card', 'color')).toEqual(
      expect.objectContaining({ file: scssSource, line: 4 }),
    );
    expect(
      declarationOrigin('.asset-alias-variable', 'background-image'),
    ).toEqual(expect.objectContaining({ file: scssPartial, line: 4 }));

    const developmentJsBytes = Buffer.byteLength(developmentJs);
    expect(developmentJs).toContain('heading: "Drupal SDC card"');
    runProductionBuild(projectDir);

    const productionJs = readFileSync(jsFile, 'utf8');
    const productionCss = readFileSync(cssFile, 'utf8');
    expect(Buffer.byteLength(productionJs)).toBeLessThan(developmentJsBytes);
    expect(productionJs.trim().split('\n').length).toBeLessThan(100);
    expect(productionJs).not.toContain('heading: "Drupal SDC card"');
    expect(productionCss.trim().split('\n')).toHaveLength(1);
    expect(productionJs).not.toContain('sourceMappingURL=');
    expect(productionCss).not.toContain('sourceMappingURL=');
    expect(existsSync(jsMapFile)).toBe(false);
    expect(existsSync(cssMapFile)).toBe(false);
  });
});
