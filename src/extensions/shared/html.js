const ATTRIBUTE_NAME_PATTERN = /^[A-Za-z_:][A-Za-z0-9:_.-]*$/;

export function isSafeAttributeName(name) {
  return ATTRIBUTE_NAME_PATTERN.test(String(name || ''));
}

export function escapeAttributeValue(value) {
  return String(value).replace(/[&"<>]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return character;
    }
  });
}
