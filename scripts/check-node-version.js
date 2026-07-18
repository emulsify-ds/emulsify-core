#!/usr/bin/env node
/**
 * @file Enforces the supported Node.js floor for project scripts.
 */

import { readFileSync } from 'node:fs';
import { isCliEntrypoint } from './lib/cli.js';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

export const SUPPORTED_NODE_ENGINE = packageJson.engines?.node;

const MINIMUM_ENGINE_PATTERN =
  /^>=(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?(?:\.(0|[1-9][0-9]*))?$/;
const NODE_VERSION_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

/**
 * Parse a Node.js version into comparable numeric parts.
 *
 * @param {string} version - Full Node.js version.
 * @returns {number[]} Major, minor, and patch parts.
 */
export function parseNodeVersion(version) {
  const match =
    typeof version === 'string' ? NODE_VERSION_PATTERN.exec(version) : null;

  if (!match) {
    throw new Error(`Invalid Node.js version "${String(version)}".`);
  }

  return match.slice(1).map(Number);
}

/**
 * Parse the intentionally narrow package engine syntax supported by this check.
 *
 * @param {string} engineExpression - package.json engines.node expression.
 * @returns {{minimumVersion: string, parts: number[]}} Parsed minimum.
 */
export function parseMinimumNodeEngine(engineExpression) {
  const match =
    typeof engineExpression === 'string'
      ? MINIMUM_ENGINE_PATTERN.exec(engineExpression)
      : null;

  if (!match) {
    throw new Error(
      `Unsupported package.json engines.node expression "${String(
        engineExpression,
      )}". Expected a single minimum such as ">=20" or ">=20.1.2".`,
    );
  }

  const parts = match.slice(1).map((part) => Number(part ?? 0));

  return {
    minimumVersion: parts.join('.'),
    parts,
  };
}

/**
 * Compare two full Node.js versions.
 *
 * @param {string} leftVersion - First version.
 * @param {string} rightVersion - Second version.
 * @returns {-1|0|1} Version ordering.
 */
export function compareNodeVersions(leftVersion, rightVersion) {
  const leftParts = parseNodeVersion(leftVersion);
  const rightParts = parseNodeVersion(rightVersion);

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }

  return 0;
}

/**
 * Determine whether a Node.js version satisfies the supported minimum.
 *
 * @param {string} currentVersion - Running or candidate Node.js version.
 * @param {string} engineExpression - package.json engines.node expression.
 * @returns {boolean} TRUE when the version is supported.
 */
export function isNodeVersionSupported(
  currentVersion,
  engineExpression = SUPPORTED_NODE_ENGINE,
) {
  const { minimumVersion } = parseMinimumNodeEngine(engineExpression);
  return compareNodeVersions(currentVersion, minimumVersion) >= 0;
}

/**
 * Format the actionable error shown for an unsupported Node.js version.
 *
 * @param {string} currentVersion - Running Node.js version.
 * @param {string} engineExpression - package.json engines.node expression.
 * @returns {string} Failure message.
 */
export function formatNodeVersionFailure(
  currentVersion,
  engineExpression = SUPPORTED_NODE_ENGINE,
) {
  const { minimumVersion } = parseMinimumNodeEngine(engineExpression);

  return (
    `Emulsify Core requires Node.js ${minimumVersion} or later ` +
    `(package.json engines.node: "${engineExpression}"). ` +
    `Current version: ${currentVersion}. Run \`nvm use\` or install a supported Node.js version.`
  );
}

/**
 * Enforce the supported minimum without mutating the running Node.js version.
 *
 * @param {string} currentVersion - Running Node.js version.
 * @param {string} engineExpression - package.json engines.node expression.
 * @returns {void}
 */
export function assertNodeVersionSupported(
  currentVersion = process.versions.node,
  engineExpression = SUPPORTED_NODE_ENGINE,
) {
  if (!isNodeVersionSupported(currentVersion, engineExpression)) {
    throw new Error(formatNodeVersionFailure(currentVersion, engineExpression));
  }
}

if (isCliEntrypoint(['check-node-version.js'])) {
  try {
    // Keep successful checks quiet so output belongs to the called command.
    assertNodeVersionSupported();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
