#!/usr/bin/env node
/**
 * @file Enforces the supported Node.js floor for project scripts.
 */

const REQUIRED_NODE_MAJOR = 24;
const [currentNodeMajor] = process.versions.node.split('.').map(Number);

if (currentNodeMajor < REQUIRED_NODE_MAJOR) {
  // Fail before npm scripts run with an unsupported runtime.
  console.error(
    `Emulsify Core requires Node.js ${REQUIRED_NODE_MAJOR} or later. ` +
      `Current version: ${process.versions.node}. Run nvm use or install Node.js 24+.`,
  );
  process.exit(1);
}

// Keep successful checks quiet so script output belongs to the called command.
