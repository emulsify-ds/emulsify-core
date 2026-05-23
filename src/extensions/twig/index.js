/**
 * @file Public exports for native Twig extensions.
 * @module extensions/twig
 */

export { getTwigFunctionMap } from './function-map.js';
export { registerTwigExtensions } from './register.js';
export {
  addAttributes,
  addAttributesTwigFunction,
} from './functions/add-attributes.js';
export { bemAttributes, bemTwigFunction } from './functions/bem.js';
