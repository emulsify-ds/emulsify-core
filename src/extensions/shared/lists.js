export function flattenList(value) {
  if (value === null || typeof value === 'undefined' || value === false) {
    return [];
  }

  if (!Array.isArray(value)) {
    return [value];
  }

  return value.flatMap((item) => flattenList(item));
}

export function uniqueList(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}
