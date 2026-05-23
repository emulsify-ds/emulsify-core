#!/usr/bin/env node

/**
 * @file Initializes a generated Emulsify project from project.emulsify.json.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Determine whether a value is a plain object.
 *
 * @param {*} obj - Value to inspect.
 * @returns {boolean} TRUE when the value is a plain object.
 */
const isObjectLiteral = (obj) =>
  obj != null && obj.constructor.name === 'Object';

/**
 * Load project.emulsify.json from the generated project config directory.
 *
 * @returns {Object} Parsed project.emulsify.json file.
 * @throws {Error} When the config cannot be loaded.
 */
const getEmulsifyConfig = () => {
  try {
    return require('../config/project.emulsify.json');
  } catch (e) {
    throw new Error(
      `Unable to load an Emulsify project config file (project.emulsify.json): ${String(
        e,
      )}`,
    );
  }
};

/**
 * Validate the minimal project configuration required for initialization.
 *
 * @param {*} config - Emulsify project config loaded from project.emulsify.json.
 * @returns {void}
 * @throws {Error} When required config values are missing or invalid.
 */
const validateEmulsifyConfig = (config) => {
  const prefix = 'Invalid project.emulsify.json config file';
  const example = JSON.stringify({
    project: {
      name: 'Example Project',
      machineName: 'example-project',
    },
  });

  if (!config) {
    throw new Error(`${prefix}.`);
  }

  if (!config.project || !isObjectLiteral(config.project)) {
    throw new Error(
      `${prefix}: Must contain a "project" key, with a name and machineName property. ${example}`,
    );
  }

  if (typeof config.project.name !== 'string') {
    throw new Error(
      `${prefix}: the "project" object must contain a "name" key with a string value. ${example}`,
    );
  }

  if (typeof config.project.machineName !== 'string') {
    throw new Error(
      `${prefix}: the "project" object must contain a "machineName" key with a string value. ${example}`,
    );
  }
};

/**
 * Move generated starter files to their project-specific names.
 *
 * @param {Array<{ to: string, from: string }>} files - Files to move.
 * @returns {Array<void>} Rename results.
 */
const renameFiles = (files) =>
  files.map(({ from, to }) =>
    fs.renameSync(path.join(__dirname, from), path.join(__dirname, to)),
  );

/**
 * Create a replacer that swaps the starter machine name for the project name.
 *
 * @param {string} machineName - Machine name that should replace `emulsify`.
 * @returns {Function} String replacer.
 */
const strReplaceEmulsify = (machineName) => (str) =>
  str.replace(/emulsify/g, machineName);

/**
 * Load a YAML file, transform its parsed contents, and write it back.
 *
 * @param {string} filePath - File to load, modify, and save.
 * @param {Function} functor - Function that returns the replacement YAML data.
 * @returns {void}
 */
const applyToYmlFile = (filePath, functor) => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error(
      `Cannot modify a file without knowing how to access it: ${filePath}`,
    );
  }
  if (typeof functor !== 'function') {
    return;
  }

  const file = yaml.load(fs.readFileSync(filePath, 'utf8'));
  fs.writeFileSync(filePath, yaml.dump(functor(file)));
};

const main = () => {
  // Load the project config before mutating any generated files.
  const config = getEmulsifyConfig();

  // Fail fast when required project metadata is missing or malformed.
  validateEmulsifyConfig(config);

  const {
    project: { machineName },
  } = config;

  // Rename starter files from the generic prefix to the project machine name.
  renameFiles([
    {
      from: '../emulsify.info.yml',
      to: `../${machineName}.info.yml`,
    },
    {
      from: '../emulsify.theme',
      to: `../${machineName}.theme`,
    },
    {
      from: '../emulsify.breakpoints.yml',
      to: `../${machineName}.breakpoints.yml`,
    },
    {
      from: '../emulsify.libraries.yml',
      to: `../${machineName}.libraries.yml`,
    },
  ]);

  // Update info.yml values that Drupal reads from the generated theme.
  applyToYmlFile(
    path.join(__dirname, `../${machineName}.info.yml`),
    (info) => ({
      ...info,
      name: machineName,
      libraries: info.libraries.map(strReplaceEmulsify(machineName)),
    }),
  );

  // Update breakpoint keys to match the renamed theme machine name.
  applyToYmlFile(
    path.join(__dirname, `../${machineName}.breakpoints.yml`),
    (breakpoints) => {
      const newBps = {};
      for (const prop of Object.keys(breakpoints)) {
        newBps[strReplaceEmulsify(machineName)(prop)] = breakpoints[prop];
      }
      return newBps;
    },
  );
};

main();
