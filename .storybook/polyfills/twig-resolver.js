import { getProjectMachineName } from '../utils';

const namespace = getProjectMachineName();

/**
 * Build a dynamic module map of Twig files from all possible component roots.
 * We rely on __EMULSIFY_ENV__ injected in .storybook/main.js via viteFinal(),
 * using the same “structure overrides / roots” logic you use in environment.js.
 */
const ENV = (typeof __EMULSIFY_ENV__ !== 'undefined' && __EMULSIFY_ENV__) || {};

// Determine candidate roots: prefer structure overrides, otherwise src/components.
const candidateRoots = Array.isArray(ENV?.structureRoots) && ENV?.structureOverrides && ENV.structureRoots.length
  ? ENV.structureRoots
  : (ENV?.srcDir ? [`${ENV.srcDir}/components`] : []);

/**
 * Convert an absolute path to a Vite project-root-relative path, prefixed with "/".
 * Keys produced by import.meta.glob() will use these forms.
 * @param {string} abs
 * @returns {string}
 */
function toRootRel(abs) {
  if (!abs) return '';
  const projectDir = ENV?.projectDir || '';
  if (projectDir && abs.startsWith(projectDir)) {
    const rel = abs.slice(projectDir.length);
    return rel.startsWith('/') ? rel : `/${rel}`;
  }
  // Fall back to assuming it's already project-root-relative-ish.
  return abs.startsWith('/') ? abs : `/${abs}`;
}

// Build globs for each candidate root. We’ll eagerly import all Twig modules.
const rootRels = candidateRoots.map(toRootRel);

// Vite doesn’t support an array directly in a single import.meta.glob(),
// so merge multiple glob maps into one.
function mergeGlobMaps(maps) {
  return Object.assign({}, ...maps);
}

// Typical component layouts we want to support:
// - Nested component folders:   /root/thing/thing.twig
// - Flat component files:       /root/thing.twig
// We pre-load everything under each root so resolution is O(1).
const twigModules = mergeGlobMaps(
  rootRels.flatMap((base) => [
    import.meta.glob(`${base}/**/*.twig`, { eager: true }),
  ])
);

// Helper: generate likely keys for a given component “part” under every root.
// We try the canonical “part/part.twig”, then “part.twig”.
function candidateKeysForPart(part) {
  const keys = [];
  for (const base of rootRels) {
    keys.push(`${base}/${part}/${part}.twig`);
    keys.push(`${base}/${part}.twig`);
  }
  return keys;
}

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
      : name.replace(new RegExp(`^@?${namespace}/`), '').replace(/\.twig$/, '');

    const candidates = candidateKeysForPart(part);
    for (const key of candidates) {
      const mod = twigModules[key];
      if (mod) {
        return mod.default ?? mod;
      }
    }

    // eslint-disable-next-line no-console
    console.error(`Cannot resolve Twig component for '${name}'. Tried: ${candidates.join(', ')}`);
  }

  // @icon.twig → icon/icon.twig (fallback to icon.twig)
  if (name.startsWith('@') && name.endsWith('.twig')) {
    const part = name.slice(1, -5); // remove leading @ and trailing .twig
    const candidates = candidateKeysForPart(part);
    for (const key of candidates) {
      const mod = twigModules[key];
      if (mod) {
        return mod.default ?? mod;
      }
    }
    // eslint-disable-next-line no-console
    console.error(`Cannot resolve Twig shorthand template '${name}'. Tried: ${candidates.join(', ')}`);
  }

  // namespace/icon.twig via alias-like usage (without @)
  if (name.startsWith(`${namespace}/`)) {
    const part = name.replace(new RegExp(`^${namespace}/`), '').replace(/\.twig$/, '');
    const candidates = candidateKeysForPart(part);
    for (const key of candidates) {
      const mod = twigModules[key];
      if (mod) {
        return mod.default ?? mod;
      }
    }
    // eslint-disable-next-line no-console
    console.error(`Cannot resolve Twig alias template '${name}'. Tried: ${candidates.join(', ')}`);
  }

  // Final attempt: direct key access if caller passed an exact glob key.
  const direct = twigModules[name];
  if (direct) {
    return direct.default ?? direct;
  }

  // Vite environment: avoid require() fallback; return a safe noop.
  // eslint-disable-next-line no-console
  console.error(`Cannot resolve Twig template '${name}'`);
  return () => '';
}

export default resolveTemplate;
