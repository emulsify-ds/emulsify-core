/**
 * @file Tests for Twig module plugin compilation and namespace behavior.
 */

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { resolveProjectConfig } from '../../project-config.js';
import {
  emulsifyTwigModulePlugin,
  makeTwigNamespaces,
  makeTwigPluginOptions,
} from '../twig-module.js';
import {
  makeEnv,
  makeTempProject,
  renderGeneratedTwigModule,
  transformTwigModule,
  twigEmbed,
  twigInclude,
  writeProjectConfig,
} from '../../test-utils/plugins.js';

describe('Twig module plugin', () => {
  let projectDir;

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  const makeTwigModulePlugin = (env) =>
    emulsifyTwigModulePlugin(makeTwigPluginOptions(env));

  it('builds Twig namespaces for src/components projects', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'src/components'), { recursive: true });
    mkdirSync(join(projectDir, 'src/layout'), { recursive: true });
    mkdirSync(join(projectDir, 'src/tokens'), { recursive: true });

    expect(makeTwigNamespaces(makeEnv(projectDir))).toEqual({
      components: join(projectDir, 'src/components'),
      layout: join(projectDir, 'src/layout'),
      tokens: join(projectDir, 'src/tokens'),
    });
  });

  it('builds Twig namespaces for top-level components projects', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'components'), { recursive: true });
    mkdirSync(join(projectDir, 'layout'), { recursive: true });
    mkdirSync(join(projectDir, 'tokens'), { recursive: true });

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
    mkdirSync(overrideRoot, { recursive: true });
    mkdirSync(join(projectDir, 'src/layout'), { recursive: true });
    mkdirSync(join(projectDir, 'src/tokens'), { recursive: true });

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
    mkdirSync(join(projectDir, 'src/components'), { recursive: true });
    mkdirSync(join(projectDir, 'src/foundation'), { recursive: true });
    mkdirSync(join(projectDir, 'src/layout'), { recursive: true });
    mkdirSync(join(projectDir, 'src/tokens'), { recursive: true });

    expect(makeTwigNamespaces(resolveProjectConfig(projectDir, {}))).toEqual({
      components: join(projectDir, 'src/components'),
      foundation: join(projectDir, 'src/foundation'),
      layout: join(projectDir, 'src/layout'),
      tokens: join(projectDir, 'src/tokens'),
    });
  });

  it('adds native Emulsify Twig functions to generic Twig rendering options', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'src/components'), { recursive: true });

    expect(
      Object.keys(makeTwigPluginOptions(makeEnv(projectDir)).functions),
    ).toEqual(['add_attributes', 'bem']);
  });

  it('can transform the same Twig module more than once', () => {
    projectDir = makeTempProject();
    const cardFile = join(projectDir, 'src/components/card/card.twig');
    mkdirSync(join(projectDir, 'src/components/card'), { recursive: true });
    writeFileSync(cardFile, '<article>{{ title }}</article>');

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

  it('can transform a child Twig module before a parent includes it', () => {
    projectDir = makeTempProject();
    const headingFile = join(projectDir, 'src/components/heading/heading.twig');
    const accordionFile = join(
      projectDir,
      'src/components/accordion/accordion.twig',
    );
    mkdirSync(join(projectDir, 'src/components/heading'), {
      recursive: true,
    });
    mkdirSync(join(projectDir, 'src/components/accordion'), {
      recursive: true,
    });
    writeFileSync(headingFile, '<h2>{{ title }}</h2>');
    writeFileSync(accordionFile, twigInclude(headingFile));

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

  it('renders nested include and embed dependencies through namespaces', () => {
    projectDir = makeTempProject();
    const accordionDir = join(projectDir, 'src/components/accordion');
    const headingDir = join(projectDir, 'src/components/heading');
    const layoutDir = join(projectDir, 'src/layout/container');
    const accordionFile = join(accordionDir, 'accordion.twig');
    mkdirSync(accordionDir, { recursive: true });
    mkdirSync(headingDir, { recursive: true });
    mkdirSync(layoutDir, { recursive: true });
    writeFileSync(join(headingDir, 'heading.twig'), '<h2>{{ title }}</h2>');
    writeFileSync(
      join(layoutDir, 'container.twig'),
      '<section class="container">{% block content %}{% endblock %}</section>',
    );
    writeFileSync(join(accordionDir, '_body.twig'), '<p>{{ body }}</p>');
    writeFileSync(
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
});
