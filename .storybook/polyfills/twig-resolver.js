/**
 * @file Runtime Twig template resolver used by Storybook polyfills.
 */

import { getProjectMachineName } from '../utils';

const namespace = getProjectMachineName();

/**
 * Build a dynamic module map of Twig files from all possible component roots.
 * We rely on __EMULSIFY_ENV__ injected in .storybook/main.js via viteFinal(),
 * using the same structure override logic used by environment.js.
 */
const ENV = (typeof __EMULSIFY_ENV__ !== 'undefined' && __EMULSIFY_ENV__) || {};

// Determine candidate roots: prefer structure overrides, otherwise the primary
// source root resolved for the project.
const candidateRoots =
  Array.isArray(ENV?.structureRoots) &&
  ENV?.structureOverrides &&
  ENV.structureRoots.length
    ? ENV.structureRoots
    : ENV?.srcDir
      ? [ENV.srcDir]
      : [];

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

// Build globs for each candidate root and eagerly import every Twig module.
const rootRels = candidateRoots.length
  ? candidateRoots.flatMap((root) => {
      const base = toRootRel(root);
      return base.endsWith('/components')
        ? [base]
        : [base, `${base}/components`];
    })
  : ['/src', '/src/components', '/components'];

// Vite does not support an array directly in a single import.meta.glob(),
// so merge multiple glob maps into one.
function mergeGlobMaps(maps) {
  return Object.assign({}, ...maps);
}

// Typical component layouts we want to support:
// - Nested component folders:   /root/thing/thing.twig
// - Flat component files:       /root/thing.twig
// We pre-load everything under each root so resolution is O(1).
const twigModules = __EMULSIFY_TWIG_GLOB_IMPORTS__;

// Generate likely keys for a component part under every configured root.
function candidateKeysForPart(part) {
  const normalizedPart = part.replace(/\.twig$/, '');
  const stem = normalizedPart.split('/').pop();
  const keys = [];
  for (const base of rootRels) {
    keys.push(`${base}/${normalizedPart}/${stem}.twig`);
    keys.push(`${base}/${normalizedPart}.twig`);
  }
  return keys;
}

function resolveCandidateKeys(candidates) {
  // Prefer the first matching key so namespace fallback order stays predictable.
  for (const key of candidates) {
    const mod = twigModules[key];
    if (mod) {
      return mod.default ?? mod;
    }
  }
  return undefined;
}

function uniqueParts(parts) {
  // Preserve resolution order while dropping duplicate guesses.
  return Array.from(new Set(parts.filter(Boolean)));
}

function removeTwigExtension(name) {
  return name.replace(/\.twig$/, '');
}

function partsFromTemplateReference(name) {
  // Project namespace references should resolve before generic namespace syntax.
  if (namespace && name.startsWith(`${namespace}:`)) {
    return [removeTwigExtension(name.split(':').slice(1).join(':'))];
  }
  if (namespace && name.startsWith(`@${namespace}/`)) {
    return [
      removeTwigExtension(name.replace(new RegExp(`^@?${namespace}/`), '')),
    ];
  }

  const colonMatch = name.match(/^[^:/.]+:(.+)$/);
  if (colonMatch) {
    return [removeTwigExtension(colonMatch[1])];
  }

  const atMatch = name.match(/^@[^/]+\/(.+)$/);
  if (atMatch) {
    return [
      removeTwigExtension(name.replace(/^@/, '')),
      removeTwigExtension(atMatch[1]),
    ];
  }

  const slashMatch = name.match(/^[^/]+\/(.+)$/);
  if (slashMatch) {
    return uniqueParts([
      removeTwigExtension(name),
      removeTwigExtension(slashMatch[1]),
    ]);
  }

  return [];
}

/**
 * Resolve template identifier to compiled Twig function.
 * Supports: @component.twig, namespace:component, @namespace/component, namespace/component
 * @param {string} name Template identifier
 * @returns {Function|undefined} Compiled function or noop
 */
function resolveTemplate(name) {
  // Exact glob keys are accepted for callers that already resolved a template.
  const direct = twigModules[name];
  if (direct) {
    return direct.default ?? direct;
  }

  // namespace:icon, @namespace/icon.twig, @namespace/icon, namespace/icon
  const namespaceParts = partsFromTemplateReference(name);
  if (namespaceParts.length) {
    const candidates = [];
    for (const namespacePart of namespaceParts) {
      const partCandidates = candidateKeysForPart(namespacePart);
      candidates.push(...partCandidates);
      const template = resolveCandidateKeys(partCandidates);
      if (template) {
        return template;
      }
    }

    // eslint-disable-next-line no-console
    console.error(
      `Cannot resolve Twig component for '${name}'. Tried: ${candidates.join(', ')}`,
    );
  }

  // @icon.twig resolves to icon/icon.twig first, then icon.twig.
  if (name.startsWith('@') && name.endsWith('.twig')) {
    const part = name.slice(1, -5); // remove leading @ and trailing .twig
    const candidates = candidateKeysForPart(part);
    const template = resolveCandidateKeys(candidates);
    if (template) {
      return template;
    }
    // eslint-disable-next-line no-console
    console.error(
      `Cannot resolve Twig shorthand template '${name}'. Tried: ${candidates.join(', ')}`,
    );
  }

  // Vite environment: avoid require() fallback; return a safe noop.
  // eslint-disable-next-line no-console
  console.error(`Cannot resolve Twig template '${name}'`);
  return () => '';
}

export default resolveTemplate;
