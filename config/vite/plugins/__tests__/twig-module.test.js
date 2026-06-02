/**
 * @file Tests for Twig module plugin compilation and namespace behavior.
 */

import fs from 'fs';
import { join } from 'path';
import Twig from 'twig';

import { resolveProjectConfig } from '../../project-config.js';
import {
  emulsifyTwigModulePlugin,
  makeTwigNamespaces,
  makeTwigPluginOptions,
  resetTwigOptionCaches,
} from '../twig-module.js';
import {
  createGeneratedTwigModuleRender,
  makeEnv,
  makeTempProject,
  renderGeneratedTwigModule,
  transformTwigModule,
  twigEmbed,
  twigInclude,
  writeProjectConfig,
} from '../../test-utils/plugins.js';
import {
  resetVirtualTwigAssetSources,
  setVirtualTwigAssetSources,
} from 'virtual:emulsify-twig-asset-sources';

describe('Twig module plugin', () => {
  let projectDir;

  beforeEach(() => {
    resetTwigOptionCaches();
  });

  afterEach(() => {
    if (projectDir) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
    resetTwigOptionCaches();
    resetVirtualTwigAssetSources();
    jest.restoreAllMocks();
  });

  /**
   * Create a Twig module plugin with fresh build-scoped caches.
   *
   * @param {object} env - Emulsify test environment.
   * @returns {import('vite').PluginOption} Initialized Twig module plugin.
   */
  const makeTwigModulePlugin = (env) => {
    const plugin = emulsifyTwigModulePlugin(makeTwigPluginOptions(env));
    plugin.buildStart();
    return plugin;
  };

  it('builds Twig namespaces for src/components projects', () => {
    projectDir = makeTempProject();
    fs.mkdirSync(join(projectDir, 'src/components'), { recursive: true });
    fs.mkdirSync(join(projectDir, 'src/layout'), { recursive: true });
    fs.mkdirSync(join(projectDir, 'src/tokens'), { recursive: true });

    expect(makeTwigNamespaces(makeEnv(projectDir))).toEqual({
      components: join(projectDir, 'src/components'),
      layout: join(projectDir, 'src/layout'),
      tokens: join(projectDir, 'src/tokens'),
    });
  });

  it('builds Twig namespaces for top-level components projects', () => {
    projectDir = makeTempProject();
    fs.mkdirSync(join(projectDir, 'components'), { recursive: true });
    fs.mkdirSync(join(projectDir, 'layout'), { recursive: true });
    fs.mkdirSync(join(projectDir, 'tokens'), { recursive: true });

    expect(
      makeTwigNamespaces(
        makeEnv(projectDir, {
          srcDir: join(projectDir, 'components'),
          srcExists: false,
        }),
      ),
    ).toEqual({
      components: join(projectDir, 'components'),
      layout: join(projectDir, 'layout'),
      tokens: join(projectDir, 'tokens'),
    });
  });

  it('prefers structure override roots for component namespaces', () => {
    projectDir = makeTempProject();
    const overrideRoot = join(projectDir, 'custom/components');
    fs.mkdirSync(overrideRoot, { recursive: true });
    fs.mkdirSync(join(projectDir, 'src/layout'), { recursive: true });
    fs.mkdirSync(join(projectDir, 'src/tokens'), { recursive: true });

    expect(
      makeTwigNamespaces(
        makeEnv(projectDir, {
          structureOverrides: true,
          structureRoots: [overrideRoot],
        }),
      ),
    ).toEqual({
      components: overrideRoot,
    });
  });

  it('builds Twig namespaces for multiple named structure roots', () => {
    projectDir = makeTempProject();
    writeProjectConfig(projectDir, {
      project: {
        platform: 'generic',
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
    fs.mkdirSync(join(projectDir, 'src/components'), { recursive: true });
    fs.mkdirSync(join(projectDir, 'src/foundation'), { recursive: true });
    fs.mkdirSync(join(projectDir, 'src/layout'), { recursive: true });
    fs.mkdirSync(join(projectDir, 'src/tokens'), { recursive: true });

    expect(makeTwigNamespaces(resolveProjectConfig(projectDir, {}))).toEqual({
      components: join(projectDir, 'src/components'),
      foundation: join(projectDir, 'src/foundation'),
      layout: join(projectDir, 'src/layout'),
      tokens: join(projectDir, 'src/tokens'),
    });
  });

  it('adds native Emulsify Twig functions to generic Twig rendering options', () => {
    projectDir = makeTempProject();
    fs.mkdirSync(join(projectDir, 'src/components'), { recursive: true });

    expect(
      Object.keys(makeTwigPluginOptions(makeEnv(projectDir)).functions),
    ).toEqual(['add_attributes', 'bem']);
  });

  it('lets the Twig module plugin handle HMR instead of Vituum full reloads', () => {
    projectDir = makeTempProject();
    fs.mkdirSync(join(projectDir, 'src/components'), { recursive: true });

    const options = makeTwigPluginOptions(makeEnv(projectDir));

    expect(options.reload(join(projectDir, 'src/components/card.twig'))).toBe(
      false,
    );
    expect(options.reload(join(projectDir, 'src/data/card.json'))).toBe(false);
  });

  it('memoizes Twig namespace and plugin options by env identity', () => {
    projectDir = makeTempProject();
    fs.mkdirSync(join(projectDir, 'src/components'), { recursive: true });

    const env = makeEnv(projectDir);
    const namespaces = makeTwigNamespaces(env);
    const options = makeTwigPluginOptions(env);

    expect(makeTwigNamespaces(env)).toBe(namespaces);
    expect(makeTwigPluginOptions(env)).toBe(options);
  });

  it('can transform the same Twig module more than once', () => {
    projectDir = makeTempProject();
    const cardFile = join(projectDir, 'src/components/card/card.twig');
    fs.mkdirSync(join(projectDir, 'src/components/card'), {
      recursive: true,
    });
    fs.writeFileSync(cardFile, '<article>{{ title }}</article>');

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const first = transformTwigModule(twigPlugin, cardFile);
    const second = transformTwigModule(twigPlugin, cardFile);

    expect(first.code).not.toContain('An error occurred whilst compiling');
    expect(second.code).not.toContain('An error occurred whilst compiling');
    expect(second.code).not.toContain(
      'There is already a template with the ID',
    );
    expect(renderGeneratedTwigModule(second.code, { title: 'Card' })).toContain(
      '<article>Card</article>',
    );
  });

  it('compiles each unique Twig path once across shared include trees', () => {
    projectDir = makeTempProject();
    const firstFile = join(projectDir, 'src/components/first/first.twig');
    const secondFile = join(projectDir, 'src/components/second/second.twig');
    const wrapperFile = join(projectDir, 'src/components/wrapper/wrapper.twig');
    const sharedFile = join(projectDir, 'src/components/shared/shared.twig');
    fs.mkdirSync(join(projectDir, 'src/components/first'), {
      recursive: true,
    });
    fs.mkdirSync(join(projectDir, 'src/components/second'), {
      recursive: true,
    });
    fs.mkdirSync(join(projectDir, 'src/components/wrapper'), {
      recursive: true,
    });
    fs.mkdirSync(join(projectDir, 'src/components/shared'), {
      recursive: true,
    });
    fs.writeFileSync(sharedFile, '<span>{{ label }}</span>');
    fs.writeFileSync(
      wrapperFile,
      [twigInclude(sharedFile), twigInclude(sharedFile)].join('\n'),
    );
    fs.writeFileSync(
      firstFile,
      [twigInclude(wrapperFile), twigInclude(sharedFile)].join('\n'),
    );
    fs.writeFileSync(
      secondFile,
      [twigInclude(wrapperFile), twigInclude(sharedFile)].join('\n'),
    );

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const factorySpy = jest.spyOn(Twig, 'factory');
    transformTwigModule(twigPlugin, firstFile);
    transformTwigModule(twigPlugin, secondFile);

    expect(factorySpy).toHaveBeenCalledTimes(
      new Set([firstFile, secondFile, wrapperFile, sharedFile]).size,
    );
  });

  it('uses the compile cache when an unchanged file is transformed twice', () => {
    projectDir = makeTempProject();
    const cardFile = join(projectDir, 'src/components/card/card.twig');
    fs.mkdirSync(join(projectDir, 'src/components/card'), {
      recursive: true,
    });
    fs.writeFileSync(cardFile, '<article>{{ title }}</article>');

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const factorySpy = jest.spyOn(Twig, 'factory');

    transformTwigModule(twigPlugin, cardFile);
    expect(factorySpy).toHaveBeenCalledTimes(1);

    factorySpy.mockClear();
    transformTwigModule(twigPlugin, cardFile);

    expect(factorySpy).not.toHaveBeenCalled();
  });

  it('memoizes filesystem probes for repeated include resolution tuples', () => {
    projectDir = makeTempProject();
    const componentDir = join(projectDir, 'src/components/card');
    const srcDir = join(projectDir, 'src');
    const firstFile = join(componentDir, 'first.twig');
    const secondFile = join(componentDir, 'second.twig');
    const thirdFile = join(componentDir, 'third.twig');
    fs.mkdirSync(componentDir, { recursive: true });
    fs.writeFileSync(firstFile, twigInclude('./missing'));
    fs.writeFileSync(secondFile, twigInclude('./missing'));
    fs.writeFileSync(thirdFile, twigInclude('./missing'));

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const statSpy = jest.spyOn(fs, 'statSync');
    const candidatePaths = new Set([
      join(componentDir, 'missing'),
      join(componentDir, 'missing.twig'),
      join(componentDir, 'missing.html.twig'),
      join(componentDir, 'missing/missing.twig'),
      join(componentDir, 'missing/missing.html.twig'),
      join(srcDir, 'missing'),
      join(srcDir, 'missing.twig'),
      join(srcDir, 'missing.html.twig'),
      join(srcDir, 'missing/missing.twig'),
      join(srcDir, 'missing/missing.html.twig'),
    ]);
    /**
     * Count only statSync calls for the repeated missing include candidates.
     *
     * @returns {number} Number of filesystem probes for the missing include.
     */
    const candidateStatCount = () =>
      statSpy.mock.calls.filter(([filePath]) => candidatePaths.has(filePath))
        .length;

    transformTwigModule(twigPlugin, firstFile);
    const afterFirstTransform = candidateStatCount();
    transformTwigModule(twigPlugin, secondFile);
    const afterSecondTransform = candidateStatCount();

    expect(afterFirstTransform).toBeLessThanOrEqual(candidatePaths.size);
    expect(afterSecondTransform).toBe(afterFirstTransform);

    twigPlugin.handleHotUpdate({ file: firstFile, server: {} });
    transformTwigModule(twigPlugin, thirdFile);

    expect(candidateStatCount()).toBeGreaterThan(afterSecondTransform);
  });

  it('does not disable Twig caching in emitted module source', () => {
    projectDir = makeTempProject();
    const cardFile = join(projectDir, 'src/components/card/card.twig');
    fs.mkdirSync(join(projectDir, 'src/components/card'), {
      recursive: true,
    });
    fs.writeFileSync(cardFile, '<article>{{ title }}</article>');

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const transformed = transformTwigModule(twigPlugin, cardFile);

    expect(transformed.code).not.toContain('Twig.cache(false)');
  });

  it('emits isolated per-module Twig factories without runtime registry patches', () => {
    projectDir = makeTempProject();
    const cardFile = join(projectDir, 'src/components/card/card.twig');
    fs.mkdirSync(join(projectDir, 'src/components/card'), {
      recursive: true,
    });
    fs.writeFileSync(cardFile, '<article>{{ title }}</article>');

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const transformed = transformTwigModule(twigPlugin, cardFile);

    expect(transformed.code).toMatch(/import \{ factory \} from 'twig';/);
    expect(transformed.code).toMatch(
      /import \{ registerTwigExtensions \} from '@emulsify\/core\/extensions\/twig';/,
    );
    expect(transformed.code).toMatch(
      /import \{ createTwigIncludeFunction \} from '@emulsify\/core\/storybook\/twig\/include-function';/,
    );
    expect(transformed.code).toMatch(
      /import twigSource from '@emulsify\/core\/storybook\/twig\/source';/,
    );
    expect(transformed.code).toContain('const Twig = factory();');
    expect(transformed.code).toContain('registerTwigExtensions(Twig);');
    expect(transformed.code).toContain('twigSource(Twig);');
    expect(transformed.code).toMatch(/Twig\.extendFunction\('include'/);
    expect(transformed.code).toContain('const __emulsifyTemplate = Twig.twig(');
    expect(transformed.code).not.toContain('__emulsifyTwigTemplateStore');
    expect(transformed.code).not.toContain('__emulsifyTwigPatchTemplateLoad');
    expect(transformed.code).not.toContain('globalThis');
  });

  it('renders updated context through the same generated module instance', () => {
    projectDir = makeTempProject();
    const cardFile = join(projectDir, 'src/components/card/card.twig');
    fs.mkdirSync(join(projectDir, 'src/components/card'), {
      recursive: true,
    });
    fs.writeFileSync(
      cardFile,
      '<article data-align="{{ align }}">{{ title }}</article>',
    );

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const transformed = transformTwigModule(twigPlugin, cardFile);
    const render = createGeneratedTwigModuleRender(transformed.code);

    expect(render({ title: 'First', align: 'left' })).toContain(
      '<article data-align="left">First</article>',
    );
    expect(render({ title: 'Second', align: 'center' })).toContain(
      '<article data-align="center">Second</article>',
    );
  });

  it('renders source() asset references through generated modules', () => {
    projectDir = makeTempProject();
    const iconFile = join(projectDir, 'src/components/icon/icon.twig');
    fs.mkdirSync(join(projectDir, 'src/components/icon'), {
      recursive: true,
    });
    fs.writeFileSync(iconFile, '{{ source("@assets/icons/refresh.svg") }}');
    setVirtualTwigAssetSources(
      {
        '/assets/icons/refresh.svg':
          '<svg data-icon="refresh" viewBox="0 0 24 24"></svg>',
      },
      ['/assets/'],
    );

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const transformed = transformTwigModule(twigPlugin, iconFile);
    const output = renderGeneratedTwigModule(transformed.code);

    expect(output).toContain('data-icon="refresh"');
    expect(output).not.toContain(
      'Template "@assets/icons/refresh.svg" is not defined',
    );
  });

  it('renders project-namespace include() function calls through generated modules', () => {
    projectDir = makeTempProject();
    const actionsGridFile = join(
      projectDir,
      'src/components/actions-grid/actions-grid.twig',
    );
    const headingFile = join(
      projectDir,
      'src/components/ui/heading/heading.twig',
    );
    fs.mkdirSync(join(projectDir, 'src/components/actions-grid'), {
      recursive: true,
    });
    fs.mkdirSync(join(projectDir, 'src/components/ui/heading'), {
      recursive: true,
    });
    fs.writeFileSync(headingFile, '<h2>{{ heading }}</h2>');
    fs.writeFileSync(
      actionsGridFile,
      [
        '<section>',
        '  {{ include("project:heading", {',
        '    heading: actions_grid_title',
        '  }, with_context: false) }}',
        '</section>',
      ].join('\n'),
    );

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const actionsGrid = transformTwigModule(twigPlugin, actionsGridFile);

    const output = renderGeneratedTwigModule(actionsGrid.code, {
      actions_grid_title: 'Actions Grid Title',
    });

    expect(output).toContain('<h2>Actions Grid Title</h2>');
    expect(output).not.toContain('include function does not exist');
  });

  it('renders project-namespace tag includes from grouped component folders', () => {
    projectDir = makeTempProject();
    const cardFile = join(projectDir, 'src/components/ui/card/card.twig');
    const buttonFile = join(projectDir, 'src/components/ui/button/button.twig');
    fs.mkdirSync(join(projectDir, 'src/components/ui/card'), {
      recursive: true,
    });
    fs.mkdirSync(join(projectDir, 'src/components/ui/button'), {
      recursive: true,
    });
    fs.writeFileSync(buttonFile, '<button>{{ label }}</button>');
    fs.writeFileSync(cardFile, '{% include "project:button" %}');

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const transformed = transformTwigModule(twigPlugin, cardFile);
    const output = renderGeneratedTwigModule(transformed.code, {
      label: 'Read more',
    });

    expect(transformed.code).not.toContain(
      'An error occurred whilst compiling',
    );
    expect(output).toContain('<button>Read more</button>');
  });

  it('renders @components tag includes from grouped component folders', () => {
    projectDir = makeTempProject();
    const cardFile = join(projectDir, 'src/components/ui/card/card.twig');
    const buttonFile = join(projectDir, 'src/components/ui/button/button.twig');
    fs.mkdirSync(join(projectDir, 'src/components/ui/card'), {
      recursive: true,
    });
    fs.mkdirSync(join(projectDir, 'src/components/ui/button'), {
      recursive: true,
    });
    fs.writeFileSync(buttonFile, '<button>{{ label }}</button>');
    fs.writeFileSync(cardFile, twigInclude('@components/button/button.twig'));

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const transformed = transformTwigModule(twigPlugin, cardFile);
    const output = renderGeneratedTwigModule(transformed.code, {
      label: 'Read more',
    });

    expect(transformed.code).not.toContain(
      'An error occurred whilst compiling',
    );
    expect(output).toContain('<button>Read more</button>');
  });

  it('preserves runtime rethrow for precompiled templates', () => {
    projectDir = makeTempProject();
    const cardFile = join(projectDir, 'src/components/card/card.twig');
    fs.mkdirSync(join(projectDir, 'src/components/card'), {
      recursive: true,
    });
    fs.writeFileSync(cardFile, '<article>{{ title|missing_filter }}</article>');

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const transformed = transformTwigModule(twigPlugin, cardFile);
    const output = renderGeneratedTwigModule(transformed.code, {
      title: 'Card',
    });

    expect(output).toContain('Unable to find filter missing_filter');
    expect(output).not.toContain('valueOf');
  });

  it('refreshes rendered output after HMR recompilation', () => {
    projectDir = makeTempProject();
    const cardFile = join(projectDir, 'src/components/card/card.twig');
    fs.mkdirSync(join(projectDir, 'src/components/card'), {
      recursive: true,
    });
    fs.writeFileSync(cardFile, '<article>{{ title }}</article>');

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const first = transformTwigModule(twigPlugin, cardFile);
    const firstRender = createGeneratedTwigModuleRender(first.code);

    expect(firstRender({ title: 'Card' })).toContain('<article>Card</article>');

    fs.writeFileSync(cardFile, '<section>{{ title }}</section>');
    fs.utimesSync(
      cardFile,
      new Date(Date.now() + 1000),
      new Date(Date.now() + 1000),
    );
    twigPlugin.handleHotUpdate({ file: cardFile, server: {} });

    const second = transformTwigModule(twigPlugin, cardFile);
    const secondRender = createGeneratedTwigModuleRender(second.code);

    expect(secondRender({ title: 'Updated' })).toContain(
      '<section>Updated</section>',
    );
  });

  it('renders embed dependencies before Twig falls back to the fs loader', () => {
    projectDir = makeTempProject();
    const accordionDir = join(projectDir, 'src/components/accordion');
    const layoutDir = join(projectDir, 'src/layout/container');
    const accordionFile = join(accordionDir, 'accordion.twig');
    const containerFile = join(layoutDir, 'container.twig');
    fs.mkdirSync(accordionDir, { recursive: true });
    fs.mkdirSync(layoutDir, { recursive: true });
    fs.writeFileSync(
      containerFile,
      '<section>{% block content %}{% endblock %}</section>',
    );
    fs.writeFileSync(
      accordionFile,
      [
        twigEmbed('@layout/container/container.twig'),
        '  {% block content %}Embedded{% endblock %}',
        '{% endembed %}',
      ].join('\n'),
    );

    const env = makeEnv(projectDir);
    const twigPlugin = makeTwigModulePlugin(env);
    const transformed = transformTwigModule(twigPlugin, accordionFile);
    const runtimeTwig = Twig.factory();
    let fsLoaderUsed = false;

    runtimeTwig.extend((TwigCore) => {
      TwigCore.Templates.registerLoader('fs', () => {
        fsLoaderUsed = true;
        throw new Error('fs loader used');
      });
    });

    const render = createGeneratedTwigModuleRender(
      transformed.code,
      runtimeTwig,
    );

    expect(render()).toContain('<section>Embedded</section>');
    expect(fsLoaderUsed).toBe(false);
  });

  it('can transform a child Twig module before a parent includes it', () => {
    projectDir = makeTempProject();
    const headingFile = join(projectDir, 'src/components/heading/heading.twig');
    const accordionFile = join(
      projectDir,
      'src/components/accordion/accordion.twig',
    );
    fs.mkdirSync(join(projectDir, 'src/components/heading'), {
      recursive: true,
    });
    fs.mkdirSync(join(projectDir, 'src/components/accordion'), {
      recursive: true,
    });
    fs.writeFileSync(headingFile, '<h2>{{ title }}</h2>');
    fs.writeFileSync(accordionFile, twigInclude(headingFile));

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const child = transformTwigModule(twigPlugin, headingFile);
    const parent = transformTwigModule(twigPlugin, accordionFile);

    expect(child.code).not.toContain('An error occurred whilst compiling');
    expect(parent.code).not.toContain('An error occurred whilst compiling');
    expect(parent.code).not.toContain(
      'There is already a template with the ID',
    );
    expect(
      renderGeneratedTwigModule(parent.code, { title: 'Included' }),
    ).toContain('<h2>Included</h2>');
  });

  it('clears cached Twig compilations for changed templates and their importers', () => {
    projectDir = makeTempProject();
    const parentFile = join(projectDir, 'src/components/parent/parent.twig');
    const sharedFile = join(projectDir, 'src/components/shared/shared.twig');
    fs.mkdirSync(join(projectDir, 'src/components/parent'), {
      recursive: true,
    });
    fs.mkdirSync(join(projectDir, 'src/components/shared'), {
      recursive: true,
    });
    fs.writeFileSync(parentFile, twigInclude(sharedFile));
    fs.writeFileSync(sharedFile, '<span>{{ label }}</span>');

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const factorySpy = jest.spyOn(Twig, 'factory');
    transformTwigModule(twigPlugin, parentFile);
    factorySpy.mockClear();

    const changedModule = { id: 'changed-template' };
    const importerModule = { id: 'importer-template' };
    const server = {
      moduleGraph: {
        getModulesByFile: jest.fn((filePath) => {
          if (filePath === sharedFile) return [changedModule];
          if (filePath === parentFile) return [importerModule];
          return [];
        }),
        invalidateModule: jest.fn(),
      },
    };

    const updatedModules = twigPlugin.handleHotUpdate({
      file: sharedFile,
      server,
    });
    transformTwigModule(twigPlugin, parentFile);

    expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(
      importerModule,
    );
    expect(updatedModules).toEqual(
      expect.arrayContaining([changedModule, importerModule]),
    );
    expect(factorySpy).toHaveBeenCalledTimes(2);
  });

  it('releases deleted dependency importer entries after unlink', () => {
    projectDir = makeTempProject();
    const parentFile = join(projectDir, 'src/components/parent/parent.twig');
    const sharedFile = join(projectDir, 'src/components/shared/shared.twig');
    const unrelatedFile = join(
      projectDir,
      'src/components/unrelated/unrelated.twig',
    );
    fs.mkdirSync(join(projectDir, 'src/components/parent'), {
      recursive: true,
    });
    fs.mkdirSync(join(projectDir, 'src/components/shared'), {
      recursive: true,
    });
    fs.mkdirSync(join(projectDir, 'src/components/unrelated'), {
      recursive: true,
    });
    fs.writeFileSync(parentFile, twigInclude(sharedFile));
    fs.writeFileSync(sharedFile, '<span>{{ label }}</span>');
    fs.writeFileSync(unrelatedFile, '<article>{{ title }}</article>');

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    transformTwigModule(twigPlugin, parentFile);
    fs.unlinkSync(sharedFile);

    const deletedModule = { id: 'deleted-template' };
    const importerModule = { id: 'importer-template' };
    const unlinkServer = {
      moduleGraph: {
        getModulesByFile: jest.fn((filePath) => {
          if (filePath === sharedFile) return [deletedModule];
          if (filePath === parentFile) return [importerModule];
          return [];
        }),
        invalidateModule: jest.fn(),
      },
    };

    const updatedModules = twigPlugin.handleHotUpdate({
      file: sharedFile,
      server: unlinkServer,
    });
    transformTwigModule(twigPlugin, unrelatedFile);

    const staleServer = {
      moduleGraph: {
        getModulesByFile: jest.fn(),
        invalidateModule: jest.fn(),
      },
    };

    expect(unlinkServer.moduleGraph.invalidateModule).toHaveBeenCalledWith(
      importerModule,
    );
    expect(updatedModules).toEqual(
      expect.arrayContaining([deletedModule, importerModule]),
    );
    expect(
      twigPlugin.handleHotUpdate({ file: sharedFile, server: staleServer }),
    ).toBeUndefined();
    expect(staleServer.moduleGraph.getModulesByFile).not.toHaveBeenCalled();
    expect(staleServer.moduleGraph.invalidateModule).not.toHaveBeenCalled();
  });

  it('uses independent Twig instances when stories share an included template', () => {
    projectDir = makeTempProject();
    const firstFile = join(projectDir, 'src/components/first/first.twig');
    const secondFile = join(projectDir, 'src/components/second/second.twig');
    const sharedFile = join(projectDir, 'src/components/shared/shared.twig');
    fs.mkdirSync(join(projectDir, 'src/components/first'), {
      recursive: true,
    });
    fs.mkdirSync(join(projectDir, 'src/components/second'), {
      recursive: true,
    });
    fs.mkdirSync(join(projectDir, 'src/components/shared'), {
      recursive: true,
    });
    fs.writeFileSync(sharedFile, '<span>{{ label }}</span>');
    fs.writeFileSync(firstFile, twigInclude(sharedFile));
    fs.writeFileSync(secondFile, twigInclude(sharedFile));

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const first = transformTwigModule(twigPlugin, firstFile);
    const second = transformTwigModule(twigPlugin, secondFile);
    const runtimeInstances = [];
    /**
     * Return a fresh Twig runtime for each generated module evaluation.
     *
     * @returns {object} Isolated Twig.js runtime instance.
     */
    const runtimeFactory = () => {
      const runtimeTwig = Twig.factory();
      runtimeInstances.push(runtimeTwig);
      return runtimeTwig;
    };
    const firstRender = createGeneratedTwigModuleRender(
      first.code,
      runtimeFactory,
    );
    const secondRender = createGeneratedTwigModuleRender(
      second.code,
      runtimeFactory,
    );

    expect(firstRender({ label: 'First' })).toContain('<span>First</span>');
    expect(secondRender({ label: 'Second' })).toContain('<span>Second</span>');
    expect(runtimeInstances).toHaveLength(2);
    expect(runtimeInstances[0]).not.toBe(runtimeInstances[1]);
  });

  it('renders nested include and embed dependencies through namespaces', () => {
    projectDir = makeTempProject();
    const accordionDir = join(projectDir, 'src/components/accordion');
    const headingDir = join(projectDir, 'src/components/heading');
    const layoutDir = join(projectDir, 'src/layout/container');
    const accordionFile = join(accordionDir, 'accordion.twig');
    fs.mkdirSync(accordionDir, { recursive: true });
    fs.mkdirSync(headingDir, { recursive: true });
    fs.mkdirSync(layoutDir, { recursive: true });
    fs.writeFileSync(join(headingDir, 'heading.twig'), '<h2>{{ title }}</h2>');
    fs.writeFileSync(
      join(layoutDir, 'container.twig'),
      '<section class="container">{% block content %}{% endblock %}</section>',
    );
    fs.writeFileSync(join(accordionDir, '_body.twig'), '<p>{{ body }}</p>');
    fs.writeFileSync(
      accordionFile,
      [
        twigInclude('@components/heading/heading.twig'),
        twigEmbed('@layout/container/container.twig'),
        '  {% block content %}',
        `    ${twigInclude('./_body.twig')}`,
        '  {% endblock %}',
        '{% endembed %}',
      ].join('\n'),
    );

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const transformed = transformTwigModule(twigPlugin, accordionFile);
    const output = renderGeneratedTwigModule(transformed.code, {
      title: 'Accordion',
      body: 'Panel body',
    });

    expect(transformed.code).not.toContain(
      'An error occurred whilst compiling',
    );
    expect(output).toContain('<h2>Accordion</h2>');
    expect(output).toContain('<section class="container">');
    expect(output).toContain('<p>Panel body</p>');
  });

  it('renders self-recursive includes without duplicate template ids', () => {
    projectDir = makeTempProject();
    const menuItemFile = join(
      projectDir,
      'src/components/navigation/base/_menu-item.twig',
    );
    fs.mkdirSync(join(projectDir, 'src/components/navigation/base'), {
      recursive: true,
    });
    fs.writeFileSync(
      menuItemFile,
      [
        '<span>{{ label }}</span>',
        '{% if child %}',
        '  {% include "@components/navigation/base/_menu-item.twig" with {',
        '    label: child.label,',
        '    child: false,',
        '  } %}',
        '{% endif %}',
      ].join('\n'),
    );

    const twigPlugin = makeTwigModulePlugin(makeEnv(projectDir));
    const transformed = transformTwigModule(twigPlugin, menuItemFile);
    const output = renderGeneratedTwigModule(transformed.code, {
      label: 'Parent',
      child: { label: 'Child' },
    });

    expect(transformed.code).not.toContain(
      'An error occurred whilst compiling',
    );
    expect(output).toContain('<span>Parent</span>');
    expect(output).toContain('<span>Child</span>');
    expect(output).not.toContain('There is already a template with the ID');
  });
});
