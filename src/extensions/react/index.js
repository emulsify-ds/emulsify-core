/**
 * @file Public exports for React extension helpers.
 * @module extensions/react
 * @reserved React extension registry behavior is not yet implemented. See
 * `register.js` for the current no-op contract.
 */

// Re-export from a single entry point for consumers and future registry growth.
export {
  createReactExtensionRegistry,
  defineReactExtension,
} from './register.js';
