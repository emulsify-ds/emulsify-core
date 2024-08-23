const path = require('path');
const emulsifyConfig = require('../../../../../project.emulsify.json');

// Get directories for file contexts.
const projectDir = path.resolve(__dirname, '../../../../..');

// Namespace patterns.
const componentNamespace = `${emulsifyConfig.project.name}:components`;
const layoutNamespace = `${emulsifyConfig.project.name}:layout`;

// Alias twig namespaces.
const TwigResolve = {
  extensions: ['.twig'],
  alias: {
    '@components': path.resolve(projectDir, 'src/components'),
    '@layouts': path.resolve(projectDir, 'src/layouts'),
    [componentNamespace]: path.resolve(projectDir, 'src/components'),
    [layoutNamespace]: path.resolve(projectDir, 'src/layouts'),
  },
};

module.exports = {
  TwigResolve,
};
