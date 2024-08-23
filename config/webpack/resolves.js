const path = require('path');
const glob = require('glob');

// Emulsify project configuration.
const emulsifyConfig = require('../../../../../project.emulsify.json');

// Get directories for file contexts.
const projectDir = path.resolve(__dirname, '../../../../..');
const projectName = emulsifyConfig.project.name;
const srcDir = path.resolve(projectDir, 'src');

// Glob pattern for twig aliases.
const aliasPattern = path.resolve(srcDir, '**/!(_*).twig');

// Prepare list of twig files to copy to "compiled" directories.
function getAliases(aliasMatcher) {
  // Create default aliases
  let aliases = {};
  glob.sync(aliasMatcher).forEach((file) => {
    const filePath = file.split('src/')[1];
    const fileName = path.basename(filePath);

    if (emulsifyConfig.project.platform === 'drupal') {
      const srcStructure = file.split(`${srcDir}/`)[1];
      const parentDir = srcStructure.split('/')[0];
      const consolidateDirs =
        parentDir === 'layout' || parentDir === 'foundation'
          ? `components/${parentDir}`
          : 'components';
      aliases[`${projectName}:${fileName.replace('.twig', '')}`] =
        filePath.replace(parentDir, consolidateDirs);
    }
  });

  if (emulsifyConfig.project.platform !== 'drupal') {
    aliases = {
      '@tokens': 'dist/tokens',
      '@foundation': 'dist/foundation',
      '@components': 'dist/components',
      '@layouts': 'dist/layouts',
    };
  }

  return aliases;
}

// Alias twig namespaces.
const TwigResolve = {
  extensions: ['.twig'],
  alias: getAliases(aliasPattern),
};

module.exports = {
  TwigResolve,
};
