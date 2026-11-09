/**
 * Разбор XML средствами браузера (DOMParser) с минимальным запасным
 * парсером для Node/Bun: так модули проверяются одними и теми же тестами,
 * а в браузере используется штатный DOMParser, как требует архитектура.
 *
 * Наружу отдаётся DOM-подобное дерево: nodeType, localName, childNodes,
 * attributes, getAttribute(), textContent.
 */

const ENTITY_MAP = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
});

function decodeEntities(value) {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return Object.prototype.hasOwnProperty.call(ENTITY_MAP, body) ? ENTITY_MAP[body] : match;
  });
}

function xmlParseError(message, index) {
  const error = new Error(`Некорректный XML (позиция ${index}): ${message}`);
  error.xmlError = true;
  return error;
}

function createDocument() {
  return {
    nodeType: 9,
    localName: '#document',
    tagName: '#document',
    childNodes: [],
    get documentElement() {
      return this.childNodes.find((node) => node.nodeType === 1) || null;
    },
    get textContent() {
      return this.childNodes.map((node) => node.textContent).join('');
    },
  };
}

function createElement(name, attributes, parentNode) {
  const colon = name.indexOf(':');
  return {
    nodeType: 1,
    tagName: name,
    localName: colon === -1 ? name : name.slice(colon + 1),
    attributes,
    parentNode,
    childNodes: [],
    get textContent() {
      return this.childNodes.map((node) => node.textContent).join('');
    },
    getAttribute(qualifiedName) {
      for (const attribute of this.attributes) {
        if (attribute.name === qualifiedName || attribute.localName === qualifiedName) {
          return attribute.value;
        }
      }
      return null;
    },
    hasAttribute(qualifiedName) {
      return this.getAttribute(qualifiedName) !== null;
    },
  };
}

function createText(data) {
  return {
    nodeType: 3,
    localName: '#text',
    tagName: '#text',
    data,
    get textContent() {
      return this.data;
    },
  };
}

/** Запасной XML-парсер (только для сред без DOMParser). */
export function parseXmlFallback(source) {
  const text = String(source);
  const length = text.length;
  let pos = 0;

  function skipWhitespace() {
    while (pos < length && /\s/.test(text[pos])) pos += 1;
  }

  function readUntil(token) {
    const end = text.indexOf(token, pos);
    if (end === -1) throw xmlParseError(`не найден «${token}»`, pos);
    const value = text.slice(pos, end);
    pos = end + token.length;
    return value;
  }

  function skipComment() {
    pos += 4;
    readUntil('-->');
  }

  function skipProcessingInstruction() {
    pos += 2;
    readUntil('?>');
  }

  function skipDeclaration() {
    pos += 2;
    if (text[pos] === '[') {
      const bracket = text.indexOf(']', pos);
      if (bracket === -1) throw xmlParseError('не закрыт DOCTYPE', pos);
      pos = bracket + 1;
    }
    readUntil('>');
  }

  function readName() {
    const start = pos;
    while (pos < length && !/[\s/>=]/.test(text[pos])) pos += 1;
    if (start === pos) throw xmlParseError('ожидалось имя элемента', pos);
    return text.slice(start, pos);
  }

  function parseElement(parent) {
    pos += 1; // '<'
    const name = readName();
    const attributes = [];
    let selfClosing = false;

    for (;;) {
      skipWhitespace();
      if (pos >= length) throw xmlParseError(`не закрыт <${name}>`, pos);
      if (text[pos] === '/' && text[pos + 1] === '>') {
        selfClosing = true;
        pos += 2;
        break;
      }
      if (text[pos] === '>') {
        pos += 1;
        break;
      }
      const attributeName = readName();
      skipWhitespace();
      if (text[pos] !== '=') throw xmlParseError(`у атрибута ${attributeName} нет значения`, pos);
      pos += 1;
      skipWhitespace();
      const quote = text[pos];
      if (quote !== '"' && quote !== "'") throw xmlParseError('значение атрибута без кавычек', pos);
      pos += 1;
      const raw = readUntil(quote);
      const colon = attributeName.indexOf(':');
      attributes.push({
        name: attributeName,
        localName: colon === -1 ? attributeName : attributeName.slice(colon + 1),
        value: decodeEntities(raw),
      });
    }

    const element = createElement(name, attributes, parent);
    parent.childNodes.push(element);
    if (selfClosing) return element;

    for (;;) {
      if (pos >= length) throw xmlParseError(`не закрыт <${name}>`, pos);
      if (text.startsWith('</', pos)) {
        pos += 2;
        const closingName = readName();
        skipWhitespace();
        if (text[pos] !== '>') throw xmlParseError('ожидался «>»', pos);
        pos += 1;
        if (closingName !== name) {
          throw xmlParseError(`закрыт <${closingName}> вместо <${name}>`, pos);
        }
        return element;
      }
      if (text.startsWith('<!--', pos)) {
        skipComment();
        continue;
      }
      if (text.startsWith('<![CDATA[', pos)) {
        pos += 9;
        element.childNodes.push(createText(readUntil(']]>')));
        continue;
      }
      if (text.startsWith('<?', pos)) {
        skipProcessingInstruction();
        continue;
      }
      if (text.startsWith('<!', pos)) {
        skipDeclaration();
        continue;
      }
      if (text[pos] === '<') {
        parseElement(element);
        continue;
      }
      const start = pos;
      while (pos < length && text[pos] !== '<') pos += 1;
      element.childNodes.push(createText(decodeEntities(text.slice(start, pos))));
    }
  }

  const document = createDocument();
  while (pos < length) {
    skipWhitespace();
    if (pos >= length) break;
    if (text.startsWith('<?', pos)) {
      skipProcessingInstruction();
    } else if (text.startsWith('<!--', pos)) {
      skipComment();
    } else if (text.startsWith('<!', pos)) {
      skipDeclaration();
    } else if (text[pos] === '<') {
      parseElement(document);
    } else {
      // Текст вне корневого элемента недопустим, но не мешает разбору.
      while (pos < length && text[pos] !== '<') pos += 1;
    }
  }

  if (!document.childNodes.some((node) => node.nodeType === 1)) {
    throw xmlParseError('в документе нет корневого элемента', 0);
  }
  return document;
}

/** Разбор XML: DOMParser в браузере, запасной парсер в Node/Bun. */
export function parseXml(source) {
  if (typeof globalThis.DOMParser === 'function') {
    const document = new globalThis.DOMParser().parseFromString(String(source), 'application/xml');
    const parserError = document.getElementsByTagName('parsererror');
    if (parserError.length > 0 || !document.documentElement) {
      const detail = parserError.length > 0 ? parserError[0].textContent : 'пустой документ';
      const error = new Error(`Некорректный XML: ${String(detail).slice(0, 200)}`);
      error.xmlError = true;
      throw error;
    }
    return document;
  }
  return parseXmlFallback(source);
}

/** Дочерние элементы (в порядке документа). */
export function childElements(node, localName = null) {
  if (!node || !node.childNodes) return [];
  const result = [];
  for (const child of node.childNodes) {
    if (child.nodeType === 1 && (localName === null || child.localName === localName)) {
      result.push(child);
    }
  }
  return result;
}

/** Первый дочерний элемент с указанным локальным именем. */
export function firstChild(node, localName) {
  if (!node || !node.childNodes) return null;
  for (const child of node.childNodes) {
    if (child.nodeType === 1 && child.localName === localName) return child;
  }
  return null;
}

/** Значение атрибута по локальному имени (префикс w:/a: не важен). */
export function getAttr(node, name) {
  if (!node || !node.attributes) return null;
  if (typeof node.getAttribute === 'function') {
    const direct = node.getAttribute(name);
    if (direct !== null && direct !== undefined) return direct;
  }
  for (const attribute of node.attributes) {
    if (attribute.localName === name || attribute.name === name) return attribute.value;
  }
  return null;
}

/** Текстовое содержимое узла. */
export function nodeText(node) {
  return node && typeof node.textContent === 'string' ? node.textContent : '';
}

/** Все потомки с указанным локальным именем (iterative). */
export function descendants(node, localName) {
  const result = [];
  if (!node || !node.childNodes) return result;
  const stack = [...node.childNodes].reverse();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.nodeType === 1) {
      if (current.localName === localName) result.push(current);
      for (let index = current.childNodes.length - 1; index >= 0; index -= 1) {
        stack.push(current.childNodes[index]);
      }
    }
  }
  return result;
}

/** Есть ли среди потомков элемент с указанным локальным именем. */
export function hasDescendant(node, localName) {
  if (!node || !node.childNodes) return false;
  const stack = [...node.childNodes];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.nodeType === 1) {
      if (current.localName === localName) return true;
      for (const child of current.childNodes) stack.push(child);
    }
  }
  return false;
}
