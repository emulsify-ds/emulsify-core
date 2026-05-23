export function defineReactExtension(extension) {
  return extension;
}

export function createReactExtensionRegistry(extensions = []) {
  return extensions.filter(Boolean);
}
