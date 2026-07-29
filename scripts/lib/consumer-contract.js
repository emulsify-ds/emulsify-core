/**
 * @file Pure validation helpers for the generated-consumer contract.
 */

/**
 * Return every consumer script named by dependency metadata.
 *
 * @param {object} contract - Consumer contract metadata.
 * @returns {string[]} Unique script names in first-seen order.
 */
export function contractScriptNames(contract) {
  return Array.from(
    new Set(
      Object.values(contract.dependencies || {}).flatMap((scripts) =>
        Array.isArray(scripts) ? scripts : [],
      ),
    ),
  );
}

/**
 * Find fixtures whose package manifests expose a script.
 *
 * @param {string} scriptName - Consumer script name.
 * @param {Map<string, object>} fixturePackages - Fixture package manifests.
 * @returns {string[]} Fixture names exposing the script.
 */
export function fixturesForScript(scriptName, fixturePackages) {
  return Array.from(fixturePackages.entries())
    .filter(([, packageJson]) => packageJson.scripts?.[scriptName])
    .map(([fixtureName]) => fixtureName);
}

/**
 * Assert that contract packages remain direct Core dependencies.
 *
 * @param {object} contract - Consumer contract metadata.
 * @param {object} packageJson - Core package manifest.
 * @param {Map<string, object>} fixturePackages - Fixture package manifests.
 * @returns {void}
 */
export function assertContractDependencies(
  contract,
  packageJson,
  fixturePackages = new Map(),
) {
  const packageDependencies = packageJson.dependencies || {};
  const missing = Object.entries(contract.dependencies || {}).filter(
    ([dependency]) => !packageDependencies[dependency],
  );

  if (!missing.length) return;

  const details = missing.map(([dependency, scripts]) => {
    const fixtureNames = Array.from(
      new Set(
        (scripts || []).flatMap((scriptName) =>
          fixturesForScript(scriptName, fixturePackages),
        ),
      ),
    );
    const fixtureText = fixtureNames.length
      ? `; fixtures: ${fixtureNames.join(', ')}`
      : '';

    return `- ${dependency} (scripts: ${(scripts || []).join(', ')}${fixtureText})`;
  });

  throw new Error(
    [
      'Missing consumer-contract dependencies in package.json#dependencies:',
      ...details,
      'Generated npm consumers rely on these packages being installed through @emulsify/core.',
      'See docs/dependency-contract.md before changing this contract.',
    ].join('\n'),
  );
}

/**
 * Assert that separately declared compatibility binaries have direct providers.
 *
 * These binaries are not attributed to generated Whisk scripts unless a real
 * script invokes them.
 *
 * @param {object} contract - Consumer contract metadata.
 * @param {object} packageJson - Core package manifest.
 * @returns {void}
 */
export function assertProvidedBinaries(contract, packageJson) {
  const packageDependencies = packageJson.dependencies || {};
  const invalid = Object.entries(contract.providedBinaries || {}).filter(
    ([binary, definition]) =>
      !binary ||
      typeof definition?.package !== 'string' ||
      !packageDependencies[definition.package],
  );

  if (!invalid.length) return;

  throw new Error(
    [
      'Invalid provided-binary contracts:',
      ...invalid.map(
        ([binary, definition]) =>
          `- ${binary} requires package.json#dependencies["${definition?.package || 'missing provider'}"]`,
      ),
    ].join('\n'),
  );
}

/**
 * Assert that fixture manifests cover and execute the declared contract.
 *
 * Watch-mode and side-effecting scripts only need to be represented in a
 * fixture manifest. Each fixture's finite `verify` list is executed by the
 * packed-consumer runner.
 *
 * @param {object} contract - Consumer contract metadata.
 * @param {Map<string, object>} fixturePackages - Fixture package manifests.
 * @returns {void}
 */
export function assertFixtureCoverage(contract, fixturePackages) {
  const fixtureDefinitions = contract.fixtures || {};
  const missingFixtures = Object.keys(fixtureDefinitions).filter(
    (fixtureName) => !fixturePackages.has(fixtureName),
  );

  if (missingFixtures.length) {
    throw new Error(
      `Consumer fixture manifests are missing: ${missingFixtures.join(', ')}.`,
    );
  }

  const nonExecutableFixtures = Object.entries(fixtureDefinitions)
    .filter(
      ([, fixture]) => !Array.isArray(fixture.verify) || !fixture.verify.length,
    )
    .map(([fixtureName]) => fixtureName);
  if (nonExecutableFixtures.length) {
    throw new Error(
      `Consumer fixtures need at least one finite verify script: ${nonExecutableFixtures.join(', ')}.`,
    );
  }

  const uncoveredScripts = contractScriptNames(contract).filter(
    (scriptName) => !fixturesForScript(scriptName, fixturePackages).length,
  );

  if (uncoveredScripts.length) {
    throw new Error(
      `Consumer contract scripts are not represented by a fixture package: ${uncoveredScripts.join(', ')}.`,
    );
  }

  const invalidVerifyScripts = Object.entries(fixtureDefinitions).flatMap(
    ([fixtureName, fixture]) => {
      const packageJson = fixturePackages.get(fixtureName);
      const verifyScripts = Array.isArray(fixture.verify) ? fixture.verify : [];

      return verifyScripts
        .filter((scriptName) => !packageJson?.scripts?.[scriptName])
        .map((scriptName) => `${fixtureName}:${scriptName}`);
    },
  );

  if (invalidVerifyScripts.length) {
    throw new Error(
      `Consumer fixture verify scripts are missing from package manifests: ${invalidVerifyScripts.join(', ')}.`,
    );
  }
}
