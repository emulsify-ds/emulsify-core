/**
 * @file Public exports for React extension helpers.
 * @module extensions/react
 */

// Re-export from a single entry point for consumers and future registry growth.
export {
  createReactExtensionRegistry,
  defineReactExtension,
} from './register.js';
