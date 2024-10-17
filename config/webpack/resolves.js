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

/**
 * Return all top-level directories from the projects source directory.
 * @constructor
 * @param {string} source - Path to source directory.
 */
function getDirectories(source) {
  const dirs = fs
    .readdirSync(source, { withFileTypes: true }) // Read contents of the directory
    .filter((dirent) => dirent.isDirectory()) // Filter only directories
    .map((dirent) => dirent.name);
  return dirs;
}

/**
 * Return clean directory names if numbering is used for sorting.
 * @constructor
 * @param {string} dir - Given directory name.
 */
function cleanDirectoryName(dir) {
  if (/^\d{2}/.test(dir)) {
    return dir.slice(3);
  }
  return dir;
}

/**
 * Return a list of twig file file paths from the project source directory.
 * @constructor
 * @param {string} aliasMatcher - Glob pattern.
 */
function getAliases(aliasMatcher) {
  // Create default aliases
  let aliases = {};
  // Add SDC compatible aliases.
  glob.sync(aliasMatcher).forEach((file) => {
    const filePath = file.split(`${srcDir}/`)[1];
    const fileName = path.basename(filePath);

    if (emulsifyConfig.project.platform === 'drupal') {
      aliases[`${projectName}/${fileName.replace('.twig', '')}`] = file;
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
