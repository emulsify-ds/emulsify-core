import {
  AttributeBag,
  attributesFromContext,
  clearContextAttributes,
} from '../../shared/attributes.js';
import { flattenList } from '../../shared/lists.js';
import { isPlainObject } from '../../shared/object.js';

function normalizeBemOptions(
  baseClass,
  modifiers,
  blockname,
  extra,
  attributes,
) {
  if (!isPlainObject(baseClass)) {
    return {
      baseClass,
      modifiers,
      blockname,
      extra,
      attributes,
    };
  }

  const options = baseClass;
  const hasBEMObjectShape = options.block && options.element;

  return {
    baseClass:
      options.baseClass ||
      options.base_class ||
      options.base ||
      (hasBEMObjectShape ? options.element : options.block),
    modifiers: options.modifiers || [],
    blockname:
      options.blockname ||
      options.blockName ||
      (hasBEMObjectShape ? options.block : options.element) ||
      '',
    extra: options.extra || [],
    attributes: options.attributes || {},
  };
}

function normalizeList(value) {
  return flattenList(value).filter((item) => {
    return item !== null && typeof item !== 'undefined' && item !== '';
  });
}

export function bemAttributes(
  baseClass,
  modifiers = [],
  blockname = '',
  extra = [],
  attributes = {},
  invocationContext,
) {
  const options = normalizeBemOptions(
    baseClass,
    modifiers,
    blockname,
    extra,
    attributes,
  );
  const normalizedBaseClass = String(options.baseClass || '').trim();
  const normalizedBlockname = String(options.blockname || '').trim();
  const classes = [];

  if (normalizedBaseClass) {
    const classPrefix = normalizedBlockname
      ? `${normalizedBlockname}__${normalizedBaseClass}`
      : normalizedBaseClass;

    classes.push(classPrefix);

    for (const modifier of normalizeList(options.modifiers)) {
      classes.push(`${classPrefix}--${modifier}`);
    }
  }

  classes.push(...normalizeList(options.extra));

  const attributeBag = new AttributeBag(options.attributes);
  attributeBag.addClass(classes);

  if (invocationContext?.context?.attributes) {
    const contextAttributes = attributesFromContext(invocationContext);
    attributeBag.merge(contextAttributes);
    clearContextAttributes(invocationContext);
  }

  return attributeBag;
}

export function bemTwigFunction(
  baseClass,
  modifiers,
  blockname,
  extra,
  attributes,
) {
  return bemAttributes(
    baseClass,
    modifiers,
    blockname,
    extra,
    attributes,
    this,
  );
}
