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
      aliases[`${projectName}:${fileName.replace('.twig', '')}`] = file;
    }
  });

  if (emulsifyConfig.project.platform === 'drupal') {
    Object.assign(aliases, {
      '@tokens': `${projectDir}/src/tokens`,
      '@foundation': `${projectDir}/src/foundation`,
      '@components': `${projectDir}/src/components`,
      '@layout': `${projectDir}/src/layout`,
    });
  } else {
    aliases = {
      '@tokens': `${projectDir}/src/tokens`,
      '@foundation': `${projectDir}/src/foundation`,
      '@components': `${projectDir}/src/components`,
      '@layout': `${projectDir}/src/layout`,
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
