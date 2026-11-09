/**
 * Разбор word/document.xml: порядок абзацев, их текст и оформление,
 * поля страницы и исключения MVP (титульный лист, заголовки, оглавление,
 * таблицы, пустые абзацы).
 */

import { parseXml, firstChild, childElements, getAttr, nodeText, descendants } from './xml.js';
import { twipsToMm } from './units.js';
import {
  resolveParagraphStyle,
  resolveRunFormatting,
} from './style-resolver.js';

function rootElement(document) {
  if (!document) return null;
  if (document.documentElement) return document.documentElement;
  return childElements(document).find((node) => node.nodeType === 1) || null;
}

const PREVIEW_LIMIT = 90;

function makePreview(text) {
  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (normalized.length <= PREVIEW_LIMIT) return normalized;
  const cut = normalized.slice(0, PREVIEW_LIMIT);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Собирает run-элементы самого абзаца, не заходя в текстовые поля
 * (w:txbxContent) и вложенные абзацы.
 */
function ownRuns(paragraphElement) {
  const runs = [];
  const stack = [...paragraphElement.childNodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.nodeType !== 1) continue;
    if (node.localName === 'txbxContent' || node.localName === 'p') continue;
    if (node.localName === 'r') {
      runs.push(node);
      // Внутри run нет вложенных абзацев, но могут быть w:t/w:br.
      continue;
    }
    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
      stack.push(node.childNodes[index]);
    }
  }
  return runs;
}

/** Потомки внутри run без текстовых полей и вложенных абзацев. */
function ownDescendants(root, localName) {
  const found = [];
  const stack = [...root.childNodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.nodeType !== 1) continue;
    if (node.localName === 'txbxContent' || node.localName === 'p') continue;
    if (node.localName === localName) found.push(node);
    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
      stack.push(node.childNodes[index]);
    }
  }
  return found;
}

function runText(runElement) {
  return ownDescendants(runElement, 't').map((node) => nodeText(node)).join('');
}

function hasPageBreakInRuns(runs) {
  return runs.some(
    (run) => ownDescendants(run, 'br').some((node) => getAttr(node, 'type') === 'page'),
  );
}

function hasSectionBreak(paragraphElement) {
  const pPr = firstChild(paragraphElement, 'pPr');
  const sectPr = pPr ? firstChild(pPr, 'sectPr') : null;
  if (!sectPr) return false;
  const typeElement = firstChild(sectPr, 'type');
  const type = typeElement ? getAttr(typeElement, 'val') : null;
  // Непрерывный разрыв раздела не переносит текст на новую страницу.
  return !type || type === 'nextPage' || type === 'oddPage' || type === 'evenPage';
}

/** Есть ли в абзаце разрыв раздела любого типа (для нумерации разделов). */
function containsSectionBreak(paragraphElement) {
  const pPr = firstChild(paragraphElement, 'pPr');
  return Boolean(pPr && firstChild(pPr, 'sectPr'));
}

/** «С новой страницы» в свойствах абзаца: разрыв перед абзацем. */
function hasPageBreakBefore(paragraphElement) {
  const pPr = firstChild(paragraphElement, 'pPr');
  const element = pPr ? firstChild(pPr, 'pageBreakBefore') : null;
  if (!element) return false;
  return getAttr(element, 'val') !== '0';
}

function isTocParagraph(paragraphElement) {
  const simpleFields = descendants(paragraphElement, 'fldSimple');
  for (const field of simpleFields) {
    const instruction = getAttr(field, 'instr') || '';
    if (/^\s*TOC\b/i.test(instruction)) return true;
  }
  const instructions = descendants(paragraphElement, 'instrText');
  for (const instruction of instructions) {
    if (/^\s*TOC\b/i.test(nodeText(instruction).trim())) return true;
  }
  const galleries = descendants(paragraphElement, 'docPartGallery');
  for (const gallery of galleries) {
    const value = getAttr(gallery, 'val') || '';
    if (/table of contents|оглавлен/i.test(value)) return true;
  }
  return false;
}

/**
 * Поля страницы из финального sectPr тела документа.
 * @returns {{left:number|null,right:number|null,top:number|null,bottom:number|null}}
 */
export function extractPageMargins(bodyElement) {
  const margins = { left: null, right: null, top: null, bottom: null };
  if (!bodyElement) return margins;
  const sections = childElements(bodyElement, 'sectPr');
  const sectPr = sections.length > 0 ? sections[sections.length - 1] : null;
  if (!sectPr) return margins;
  const pgMar = firstChild(sectPr, 'pgMar');
  if (!pgMar) return margins;
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const raw = getAttr(pgMar, side);
    if (raw === null) continue;
    const twips = Number(raw);
    if (Number.isFinite(twips) && twips >= 0) margins[side] = twipsToMm(twips);
  }
  return margins;
}

function collectTableParagraphs(tableElement, startIndex, sectionIndex) {
  const records = [];
  let index = startIndex;
  for (const paragraph of descendants(tableElement, 'p')) {
    index += 1;
    records.push({
      index,
      preview: '',
      sectionIndex,
      skippedReason: 'table',
      properties: null,
    });
  }
  return { records, nextIndex: index };
}

/**
 * @param {string} documentXml
 * @param {ReturnType<import('./style-resolver.js').buildStyleContext>} context
 * @param {Function} [parse]
 */
export function parseDocumentXml(documentXml, context, parse = parseXml) {
  const document = parse(documentXml);
  const root = rootElement(document);
  const body = root ? firstChild(root, 'body') : null;
  if (!body) {
    throw new Error('В document.xml нет тела документа (w:body)');
  }

  const records = [];
  let index = 0;
  let sectionIndex = 0;
  // Титульный лист определяется только при наличии явного разрыва страницы.
  // Если разрывов нет вовсе, границу титульного листа найти нельзя: проверяем
  // весь документ, иначе короткие работы без разрыва давали бы пустой отчёт.
  let titlePageOpen = descendants(body, 'p').some(
    (paragraph) => hasPageBreakInRuns(ownRuns(paragraph))
      || hasSectionBreak(paragraph)
      || hasPageBreakBefore(paragraph),
  );

  function processParagraph(paragraphElement) {
    index += 1;
    const runs = ownRuns(paragraphElement);
    const text = runs.map(runText).join('');
    const preview = makePreview(text);

    const pageBreak = hasPageBreakInRuns(runs) || hasSectionBreak(paragraphElement);
    // pageBreakBefore относится к самому абзацу: титульный лист кончается до него.
    if (titlePageOpen && hasPageBreakBefore(paragraphElement)) titlePageOpen = false;
    const inTitlePage = titlePageOpen;
    if (titlePageOpen && pageBreak) titlePageOpen = false;

    let skippedReason = null;
    let resolved = null;

    if (inTitlePage) {
      skippedReason = 'title';
    } else if (text.trim() === '') {
      skippedReason = 'empty';
    } else {
      resolved = resolveParagraphStyle(paragraphElement, context);
      if (resolved.isToc || isTocParagraph(paragraphElement)) {
        skippedReason = 'toc';
      } else if (resolved.isHeading) {
        skippedReason = 'heading';
      } else if (resolved.unknownStyle) {
        skippedReason = 'unknown-style';
      }
    }

    const record = {
      index,
      preview,
      sectionIndex,
      skippedReason,
      properties: null,
    };

    if (!skippedReason && resolved) {
      const formattedRuns = [];
      for (const runElement of runs) {
        const runTextValue = runText(runElement);
        if (runTextValue.trim() === '') continue;
        const formatting = resolveRunFormatting(runElement, resolved, context);
        formattedRuns.push({
          text: runTextValue,
          fontFamily: formatting.fontFamily,
          fontKnown: formatting.fontKnown,
          fontSizePt: formatting.fontSizePt,
          sizeKnown: formatting.sizeKnown,
        });
      }

      record.properties = {
        styleId: resolved.styleId,
        styleName: resolved.styleName,
        paragraph: resolved.paragraph,
        runs: formattedRuns,
      };
    }

    records.push(record);
    // Раздел заканчивается на абзаце с sectPr; следующий абзац уже в новом.
    if (containsSectionBreak(paragraphElement)) sectionIndex += 1;
  }

  function walk(container) {
    for (const element of childElements(container)) {
      if (element.localName === 'p') {
        processParagraph(element);
      } else if (element.localName === 'tbl') {
        const table = collectTableParagraphs(element, index, sectionIndex);
        index = table.nextIndex;
        records.push(...table.records);
      } else if (element.localName === 'sdt' || element.localName === 'sdtContent'
        || element.localName === 'customXml' || element.localName === 'ins') {
        walk(element);
      }
      // sectPr и прочие служебные элементы не создают абзацев.
    }
  }

  walk(body);

  return {
    paragraphs: records,
    pageMargins: extractPageMargins(body),
    totalParagraphs: records.length,
    sectionCount: sectionIndex + 1,
  };
}
