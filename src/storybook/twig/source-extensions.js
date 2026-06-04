/**
 * @file Shared file extension sets for Twig source() handling.
 */

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
