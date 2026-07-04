#!/usr/bin/env node
/**
 * @file Enforces the supported Node.js floor for project scripts.
 */

const REQUIRED_NODE_VERSION = '24.11.0';
const REQUIRED_NODE_PARTS = REQUIRED_NODE_VERSION.split('.').map(Number);
const currentNodeParts = process.versions.node.split('.').map(Number);

let isBeforeRequiredVersion = false;

for (let index = 0; index < REQUIRED_NODE_PARTS.length; index++) {
  const currentPart = currentNodeParts[index] ?? 0;
  const requiredPart = REQUIRED_NODE_PARTS[index];

  if (currentPart !== requiredPart) {
    isBeforeRequiredVersion = currentPart < requiredPart;
    break;
  }
}

if (isBeforeRequiredVersion) {
  // Fail before npm scripts run with an unsupported runtime.
  console.error(
    `Emulsify Core requires Node.js ${REQUIRED_NODE_VERSION} or later. ` +
      `Current version: ${process.versions.node}. Run nvm use or install Node.js ${REQUIRED_NODE_VERSION}+.`,
  );
  process.exit(1);
}

// Keep successful checks quiet so script output belongs to the called command.
