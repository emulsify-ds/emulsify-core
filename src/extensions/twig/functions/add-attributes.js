import {
  AttributeBag,
  attributesFromContext,
  clearContextAttributes,
} from '../../shared/attributes.js';

export function addAttributes(additionalAttributes = {}, invocationContext) {
  const attributeBag = attributesFromContext(invocationContext);
  attributeBag.merge(additionalAttributes);
  clearContextAttributes(invocationContext);

  return attributeBag;
}

export function addAttributesTwigFunction(additionalAttributes = {}) {
  return addAttributes(additionalAttributes, this);
}

export { AttributeBag };
