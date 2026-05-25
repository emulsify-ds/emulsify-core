/**
 * @file Tests for the Storybook Twig template resolver.
 */

import {
  buildTwigRootRecords,
  candidateKeysForReference,
  candidateKeysForRoot,
  createTwigResolver,
} from './resolver.js';

const projectDir = '/project';

const createEnv = () => ({
  projectDir,
  machineName: 'whisk',
  projectStructure: {
    componentRootRecords: [
      { name: 'components', directory: `${projectDir}/src/components` },
    ],
    twigRoots: [`${projectDir}/src/components`, `${projectDir}/src/layout`],
    namespaceRoots: {
      components: `${projectDir}/src/components`,
      layout: `${projectDir}/src/layout`,
    },
  },
});

describe('Storybook Twig resolver', () => {
  it('builds roots from the normalized project structure', () => {
    expect(buildTwigRootRecords(createEnv())).toEqual([
      {
        name: 'components',
        directory: '/project/src/components',
        rootRel: '/src/components',
      },
      {
        name: 'layout',
        directory: '/project/src/layout',
        rootRel: '/src/layout',
      },
      {
        name: undefined,
        directory: '/project/src/components',
        rootRel: '/src/components',
      },
      {
        name: undefined,
        directory: '/project/src/layout',
        rootRel: '/src/layout',
      },
      {
        name: undefined,
        directory: '/project/src',
        rootRel: '/src',
      },
      {
        name: undefined,
        directory: '/project/components',
        rootRel: '/components',
      },
    ]);
  });

  it('builds candidate keys for explicit and shorthand component references', () => {
    expect(candidateKeysForRoot('/src/components', 'button')).toEqual([
      '/src/components/button/button.twig',
      '/src/components/button/button.html.twig',
      '/src/components/button.twig',
      '/src/components/button.html.twig',
    ]);
    expect(
      candidateKeysForRoot('/src/components', 'button/button.html.twig'),
    ).toEqual([
      '/src/components/button/button.html.twig',
      '/src/components/button/button.twig',
    ]);

    expect(
      candidateKeysForReference('@components/button/button.twig', createEnv()),
    ).toContain('/src/components/button/button.twig');
    expect(
      candidateKeysForReference('components:button', createEnv()),
    ).toContain('/src/components/button/button.twig');
    expect(candidateKeysForReference('whisk:button', createEnv())).toContain(
      '/src/components/button/button.twig',
    );
  });

  it('resolves compiled Twig modules and raw Twig source', () => {
    const buttonTemplate = jest.fn(() => '<button>Button</button>');
    const resolver = createTwigResolver({
      env: createEnv(),
      modules: {
        '/src/components/button/button.twig': { default: buttonTemplate },
      },
      sources: {
        '/src/components/button/button.twig': '<button>{{ text }}</button>',
      },
    });

    expect(resolver.resolveTemplate('@components/button/button.twig')).toBe(
      buttonTemplate,
    );
    expect(resolver.resolveTemplate('components:button')).toBe(buttonTemplate);
    expect(resolver.resolveTemplate('missing')).toBeUndefined();
    expect(
      resolver.resolveTemplateSource('@components/button/button.twig'),
    ).toBe('<button>{{ text }}</button>');
  });

  it('resolves named variant structure roots as Twig namespaces', () => {
    const env = {
      projectDir,
      projectStructure: {
        componentRootRecords: [
          { name: 'components', directory: `${projectDir}/src/components` },
          { name: 'foundation', directory: `${projectDir}/src/foundation` },
          { name: 'layout', directory: `${projectDir}/src/layout` },
          { name: 'tokens', directory: `${projectDir}/src/tokens` },
        ],
        namespaceRoots: {
          components: `${projectDir}/src/components`,
          foundation: `${projectDir}/src/foundation`,
          layout: `${projectDir}/src/layout`,
          tokens: `${projectDir}/src/tokens`,
        },
      },
    };
    const paletteTemplate = jest.fn(() => '<div>Palette</div>');
    const resolver = createTwigResolver({
      env,
      modules: {
        '/src/foundation/colors/palette.twig': {
          default: paletteTemplate,
        },
      },
      sources: {
        '/src/tokens/color/color.twig': '<span>{{ color }}</span>',
      },
    });

    expect(resolver.resolveTemplate('@foundation/colors/palette.twig')).toBe(
      paletteTemplate,
    );
    expect(
      candidateKeysForReference('@tokens/color/color.twig', env),
    ).toContain('/src/tokens/color/color.twig');
    expect(resolver.resolveTemplateSource('@tokens/color/color.twig')).toBe(
      '<span>{{ color }}</span>',
    );
  });
});
