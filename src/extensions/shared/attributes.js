import { escapeAttributeValue, isSafeAttributeName } from './html.js';
import { flattenList, uniqueList } from './lists.js';
import { isPlainObject } from './object.js';

const classNameCache = new Map();
const attributeBags = new WeakSet();

function cleanClassToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (classNameCache.has(raw)) {
    return classNameCache.get(raw);
  }

  const cleaned = raw
    .replace(/[^_a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^([0-9])/, '_$1');

  classNameCache.set(raw, cleaned);
  return cleaned;
}

export function classTokensFromValue(value) {
  if (isAttributeBag(value)) {
    return value.getClassList();
  }

  return uniqueList(
    flattenList(value)
      .flatMap((item) => String(item || '').split(/\s+/))
      .map((item) => cleanClassToken(item))
      .filter(Boolean),
  );
}

function valueToAttributeParts(value) {
  if (isAttributeBag(value)) {
    return value.toObject();
  }

  if (value === null || typeof value === 'undefined' || value === false) {
    return null;
  }

  if (Array.isArray(value)) {
    return flattenList(value)
      .filter((item) => item !== null && typeof item !== 'undefined')
      .map((item) => String(item));
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'string') {
    return String(value);
  }

  if (
    typeof value?.toString === 'function' &&
    value.toString !== Object.prototype.toString
  ) {
    return String(value);
  }

  return null;
}

function parseClassAttributeString(value) {
  const match = String(value || '').match(/^class=(["'])(.*?)\1$/);
  return match ? match[2] : null;
}

export function isAttributeBag(value) {
  return Boolean(
    value && typeof value === 'object' && attributeBags.has(value),
  );
}

export class AttributeBag {
  constructor(initialAttributes = {}) {
    attributeBags.add(this);
    this.attributes = new Map();

    this.merge(initialAttributes);
  }

  clone() {
    return new AttributeBag(this.toObject());
  }

  getClassList() {
    return this.attributes.get('class') || [];
  }

  addClass(value) {
    const tokens = classTokensFromValue(value);
    if (!tokens.length) return this;

    const existing = this.attributes.get('class') || [];
    this.attributes.set('class', uniqueList([...existing, ...tokens]));
    return this;
  }

  set(name, value) {
    const attributeName = String(name || '').trim();
    if (!isSafeAttributeName(attributeName)) return this;

    if (attributeName === 'class') {
      const classString =
        typeof value === 'string' ? parseClassAttributeString(value) : null;
      this.addClass(classString || value);
      return this;
    }

    const normalizedValue = valueToAttributeParts(value);
    if (normalizedValue === null) return this;

    this.attributes.set(attributeName, normalizedValue);
    return this;
  }

  merge(value) {
    if (!value) return this;

    if (isAttributeBag(value)) {
      for (const [name, attributeValue] of value.attributes.entries()) {
        this.set(name, attributeValue);
      }
      return this;
    }

    if (!isPlainObject(value)) {
      return this;
    }

    for (const [name, attributeValue] of Object.entries(value)) {
      if (name === '_keys') continue;
      this.set(name, attributeValue);
    }

    return this;
  }

  toObject() {
    return Object.fromEntries(this.attributes.entries());
  }

  toString() {
    return Array.from(this.attributes.entries())
      .map(([name, value]) => {
        if (name === 'class' && Array.isArray(value)) {
          if (!value.length) return '';
          return `class="${escapeAttributeValue(value.join(' '))}"`;
        }

        if (value === true) {
          return name;
        }

        if (Array.isArray(value)) {
          return `${name}="${escapeAttributeValue(value.join(' '))}"`;
        }

        return `${name}="${escapeAttributeValue(value)}"`;
      })
      .filter(Boolean)
      .join(' ');
  }
}

export function attributesFromContext(invocationContext) {
  return new AttributeBag(invocationContext?.context?.attributes || {});
}

export function clearContextAttributes(invocationContext) {
  if (
    invocationContext?.context &&
    Object.hasOwn(invocationContext.context, 'attributes')
  ) {
    invocationContext.context.attributes = {};
  }
}
