import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseXml,
  parseXmlFallback,
  childElements,
  firstChild,
  getAttr,
  nodeText,
  descendants,
  hasDescendant,
} from '../assets/js/xml.js';

const SAMPLE = `<?xml version="1.0"?>
<!-- комментарий -->
<w:root xmlns:w="urn:w" xml:space="preserve">
  <w:item w:val="1" name="a &amp; b">Текст &lt;1&gt;</w:item>
  <w:empty/>
  <![CDATA[<сырой>]]>
  <w:item w:val='2'>Второй</w:item>
</w:root>`;

test('запасной парсер читает элементы, атрибуты и сущности', () => {
  const document = parseXmlFallback(SAMPLE);
  const root = childElements(document)[0];
  assert.equal(root.localName, 'root');
  const items = childElements(root, 'item');
  assert.equal(items.length, 2);
  assert.equal(getAttr(items[0], 'val'), '1');
  assert.equal(getAttr(items[0], 'name'), 'a & b');
  assert.equal(nodeText(items[0]), 'Текст <1>');
  assert.equal(childElements(root, 'empty').length, 1);
  assert.equal(descendants(root, 'item').length, 2);
  assert.equal(hasDescendant(root, 'empty'), true);
  assert.equal(hasDescendant(root, 'missing'), false);
});

test('parseXml без DOMParser использует запасной парсер', () => {
  const document = parseXml('<root><a x="1">ok</a></root>');
  const root = childElements(document)[0];
  assert.equal(root.localName, 'root');
  assert.equal(nodeText(firstChild(root, 'a')), 'ok');
});

test('запасной парсер декодирует числовые сущности', () => {
  const document = parseXmlFallback('<root>&#1055;&#x440;&#1080;&#1074;&#1077;&#1090;</root>');
  assert.equal(nodeText(childElements(document)[0]), 'Привет');
});

test('некорректный XML даёт ошибку разбора', () => {
  assert.throws(() => parseXmlFallback('<a><b></a>'), /Некорректный XML/);
  assert.throws(() => parseXmlFallback('<a>'), /Некорректный XML/);
  assert.throws(() => parseXmlFallback(''), /Некорректный XML/);
});

test('текст вне корня не мешает разбору, а комментарии пропускаются', () => {
  const document = parseXmlFallback('мусор<root><!--x--><a>1</a></root>');
  const root = childElements(document)[0];
  assert.equal(root.localName, 'root');
  assert.equal(nodeText(root), '1');
});
