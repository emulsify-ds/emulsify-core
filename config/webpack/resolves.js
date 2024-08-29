const path = require('path');
const glob = require('glob');
const fs = require('fs-extra');

// Emulsify project configuration.
const emulsifyConfig = require('../../../../../project.emulsify.json');

// Get directories for file contexts.
const projectDir = path.resolve(__dirname, '../../../../..');
const projectName = emulsifyConfig.project.name;
const srcDir = fs.existsSync(path.resolve(projectDir, 'src'))
  ? path.resolve(projectDir, 'src')
  : path.resolve(projectDir, 'components');

// Glob pattern for twig aliases.
const aliasPattern = path.resolve(srcDir, '**/!(_*).twig');

// Get all directories from a specified directory.
function getDirectories(source) {
  const dirs = fs
    .readdirSync(source, { withFileTypes: true }) // Read contents of the directory
    .filter((dirent) => dirent.isDirectory()) // Filter only directories
    .map((dirent) => dirent.name);
  return dirs;
}

// Clean up directory names for namespacing purposes.
function cleanDirectoryName(dir) {
  if (/^\d{2}/.test(dir)) {
    return dir.slice(3);
  }
  return dir;
}

// Prepare list of twig files to copy to "compiled" directories.
function getAliases(aliasMatcher) {
  // Create default aliases
  let aliases = {};
  // Add SDC compatible aliases.
  glob.sync(aliasMatcher).forEach((file) => {
    const filePath = file.split(`${srcDir}/`)[1];
    const fileName = path.basename(filePath);

    if (emulsifyConfig.project.platform === 'drupal') {
      aliases[`${projectName}:${fileName.replace('.twig', '')}`] = file;
    }
  });
  // Add typical @namespace (path to directory) aliases for twig partials.
  const dirs = getDirectories(srcDir);
  dirs.forEach((dir) => {
    const name = cleanDirectoryName(dir);
    Object.assign(aliases, {
      [`@${name}`]: `${projectDir}/${path.basename(srcDir)}/${dir}`,
    });
  });
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
