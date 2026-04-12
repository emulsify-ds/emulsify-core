import { getProjectMachineName } from '../utils.js';

const namespace = getProjectMachineName();

const twigComponents = require.context(
  '../../../../../src/components/',
  true,
  /\.twig$/,
);

/**
 * Resolve template identifier to compiled Twig function.
 * Supports: @component.twig, namespace:component, @namespace/component, namespace/component
 * @param {string} name Template identifier
 * @returns {Function|undefined} Compiled function or noop
 */
function resolveTemplate(name) {
  // namespace:icon, @namespace/icon.twig
  if (name.startsWith(`${namespace}:`) || name.startsWith(`@${namespace}/`)) {
    const part = name.startsWith(`${namespace}:`)
      ? name.split(':')[1]
      : name.replace(`${namespace}/`, '').replace('.twig', '');
    const path = `./${part}/${part}.twig`;
    try {
      const mod = twigComponents(path);
      return mod && mod.default ? mod.default : mod;
    } catch {
      console.error(`Cannot resolve Twig component for '${name}' at '${path}'`);
    }
  }

  // @icon.twig → icon/icon.twig
  if (name.startsWith('@') && name.endsWith('.twig')) {
    const part = name.slice(1, -5); // remove leading @ and trailing .twig
    const path = `./${part}/${part}.twig`;
    try {
      return twigComponents(path).default || twigComponents(path);
    } catch {
      console.error(
        `Cannot resolve Twig shorthand template '${name}' at '${path}'`,
      );
    }
  }

  // namespace/icon.twig via webpack alias
  if (name.startsWith(`${namespace}/`)) {
    const part = name.slice(namespace.length + 1).replace('.twig', '');
    const path = `./${part}/${part}.twig`;
    try {
      return twigComponents(path).default || twigComponents(path);
    } catch {
      console.error(
        `Cannot resolve Twig alias template '${name}' at '${path}'`,
      );
    }
  }

  try {
    // Storybook resolves runtime Twig requests through webpack, so this
    // fallback intentionally loads a module path determined at render time.
    // eslint-disable-next-line security/detect-non-literal-require
    const mod = require(name);
    return mod && mod.default ? mod.default : mod;
  } catch (error) {
    console.error(`Cannot resolve Twig template '${name}'`, error);
    return () => '';
  }
}

export default resolveTemplate;
