import { addAttributesTwigFunction } from './functions/add-attributes.js';
import { bemTwigFunction } from './functions/bem.js';

export function getTwigFunctionMap() {
  return {
    add_attributes: addAttributesTwigFunction,
    bem: bemTwigFunction,
  };
}
