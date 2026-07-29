/**
 * @file Shared constants for Twig source() handling.
 */

export const TWIG_SOURCE_LOADED_EVENT = 'emulsify:twig-source-loaded';

// Text assets can be safely inlined; binary assets should remain URL-based.
export const INLINE_ASSET_EXTS = new Set([
  'svg',
  'html',
  'twig',
  'css',
  'js',
  'json',
  'txt',
  'md',
]);

export const IMAGE_ASSET_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
]);
