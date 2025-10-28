import { getProjectMachineName } from '../utils';

const namespace = getProjectMachineName();

const twigComponents = require.context(
  '../../../../../src/components/',
  true,
  /\.twig$/
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
    const part = name.startsWith(`${namespace}:`) ? name.split(':')[1] : name.replace(`${namespace}/`, '').replace('.twig', '');
    const path = `./${part}/${part}.twig`;
    try {
      {
        const mod = twigComponents(path);
        return mod && mod.default ? mod.default : mod;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`Cannot resolve Twig component for '${name}' at '${path}'`);
    }
  }

  // @icon.twig → icon/icon.twig
  if (name.startsWith('@') && name.endsWith('.twig')) {
    const part = name.slice(1, -5); // remove leading @ and trailing .twig
    const path = `./${part}/${part}.twig`;
    try {
      return twigComponents(path).default || twigComponents(path);
    } catch (e) {
      console.error(`Cannot resolve Twig shorthand template '${name}' at '${path}'`);
    }
  }

  // namespace/icon.twig via webpack alias
  if (name.startsWith(`${namespace}/`)) {
    const part = name.replace(new RegExp(`^${namespace}/`), '').replace('.twig', '');
    const path = `./${part}/${part}.twig`;
    try {
      return twigComponents(path).default || twigComponents(path);
    } catch (e) {
      console.error(`Cannot resolve Twig alias template '${name}' at '${path}'`);
    }
  }

  try {
    {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const mod = require(name);
      return mod && mod.default ? mod.default : mod;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`Cannot resolve Twig template '${name}'`, e);
    return () => '';
  }
};

export default resolveTemplate;
