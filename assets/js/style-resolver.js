/**
 * Вычисление итогового оформления абзаца с учётом наследования Word:
 * docDefaults → цепочка basedOn стиля абзаца → прямое форматирование абзаца
 * → прямое форматирование фрагмента (run).
 *
 * Возвращаются вычисленные значения вместе с флагами known: если значение
 * определить нельзя (например, интервал задан в точках, а не кратностью),
 * правило должно быть пропущено, а не превращено в ложное нарушение.
 */

import { parseXml, firstChild, childElements, getAttr, descendants } from './xml.js';
import { halfPointsToPt, twipsToMm, lineTwipsToMultiple } from './units.js';

function rootElement(document) {
  if (!document) return null;
  if (document.documentElement) return document.documentElement;
  return childElements(document).find((node) => node.nodeType === 1) || null;
}

const HEADING_NAME_RE = /^(heading|заголовок)\s*[1-9]/i;
const HEADING_ID_RE = /^Heading[1-9]/i;
const TOC_NAME_RE = /^(toc|оглавлен|содержан)/i;
const TOC_ID_RE = /^TOC[0-9]/i;

const ALIGNMENT_MAP = Object.freeze({
  left: 'left',
  start: 'left',
  center: 'center',
  right: 'right',
  end: 'right',
  both: 'justify',
  justify: 'justify',
  distribute: 'justify',
});

function themeFontName(theme, reference) {
  if (!theme || !reference) return null;
  const lower = String(reference).toLowerCase();
  if (lower.startsWith('major')) return theme.major || null;
  if (lower.startsWith('minor')) return theme.minor || null;
  return null;
}

function readThemeFonts(themeXml, parse) {
  if (!themeXml) return { major: null, minor: null };
  try {
    const document = parse(themeXml);
    const root = rootElement(document);
    if (!root) return { major: null, minor: null };
    const themeElements = firstChild(root, 'themeElements');
    const fontScheme = themeElements ? firstChild(themeElements, 'fontScheme') : null;
    if (!fontScheme) return { major: null, minor: null };

    const pick = (schemeName) => {
      const scheme = firstChild(fontScheme, schemeName);
      if (!scheme) return null;
      const latin = firstChild(scheme, 'latin');
      const cyrillic = descendants(scheme, 'font').find((node) => {
        const script = getAttr(node, 'script');
        return script === 'Cyrl' || script === 'cyrl';
      });
      const cyrTypeface = cyrillic ? getAttr(cyrillic, 'typeface') : null;
      const latinTypeface = latin ? getAttr(latin, 'typeface') : null;
      return cyrTypeface || latinTypeface || null;
    };

    return { major: pick('majorFont'), minor: pick('minorFont') };
  } catch {
    // Битая тема не должна ломать проверку: шрифт из темы останется неизвестным.
    return { major: null, minor: null };
  }
}

/**
 * @param {{stylesXml?: string|null, themeXml?: string|null, parseXml?: Function}} parts
 */
export function buildStyleContext({ stylesXml = null, themeXml = null, parseXml: parse = parseXml } = {}) {
  const context = {
    docDefaults: { pPr: null, rPr: null },
    styles: new Map(),
    defaultParagraphStyleId: null,
    theme: readThemeFonts(themeXml, parse),
  };

  if (!stylesXml) return context;

  const document = parse(stylesXml);
  const root = rootElement(document);
  if (!root) return context;

  const docDefaults = firstChild(root, 'docDefaults');
  if (docDefaults) {
    const rPrDefault = firstChild(docDefaults, 'rPrDefault');
    const pPrDefault = firstChild(docDefaults, 'pPrDefault');
    context.docDefaults.rPr = rPrDefault ? firstChild(rPrDefault, 'rPr') : null;
    context.docDefaults.pPr = pPrDefault ? firstChild(pPrDefault, 'pPr') : null;
  }

  for (const styleElement of childElements(root, 'style')) {
    const id = getAttr(styleElement, 'styleId');
    if (!id) continue;
    const type = getAttr(styleElement, 'type') || 'paragraph';
    const nameElement = firstChild(styleElement, 'name');
    const basedOnElement = firstChild(styleElement, 'basedOn');
    const style = {
      id,
      type,
      name: nameElement ? getAttr(nameElement, 'val') : null,
      basedOn: basedOnElement ? getAttr(basedOnElement, 'val') : null,
      isDefault: getAttr(styleElement, 'default') === '1',
      pPr: firstChild(styleElement, 'pPr'),
      rPr: firstChild(styleElement, 'rPr'),
    };
    context.styles.set(id, style);
    if (type === 'paragraph' && style.isDefault && !context.defaultParagraphStyleId) {
      context.defaultParagraphStyleId = id;
    }
  }

  return context;
}

/** Цепочка стилей от корня к потомку (низкий → высокий приоритет). */
function resolveStyleChain(context, styleId) {
  const chain = [];
  const seen = new Set();
  let currentId = styleId;
  let incomplete = false;

  while (currentId) {
    if (seen.has(currentId)) {
      incomplete = true;
      break;
    }
    seen.add(currentId);
    const style = context.styles.get(currentId);
    if (!style) {
      incomplete = true;
      break;
    }
    chain.unshift(style);
    currentId = style.basedOn || null;
  }

  return { chain, incomplete };
}

/** Последнее определённое значение атрибута по уровням (низкий → высокий). */
function pickAttribute(levels, elementName, attributeName) {
  for (let index = levels.length - 1; index >= 0; index -= 1) {
    const element = firstChild(levels[index], elementName);
    if (!element) continue;
    const value = getAttr(element, attributeName);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function detectHeading(chain, outlineLevel) {
  if (outlineLevel !== null) {
    const level = Number(outlineLevel);
    // 9 — обычный текст; 0..8 — уровни заголовков.
    if (Number.isInteger(level) && level >= 0 && level <= 8) return true;
  }
  return chain.some((style) => {
    if (style.type !== 'paragraph') return false;
    return (style.name && HEADING_NAME_RE.test(style.name))
      || HEADING_ID_RE.test(style.id)
      || /^[1-9]$/.test(style.id) && style.name && /heading/i.test(style.name);
  });
}

function detectToc(chain) {
  return chain.some((style) => {
    if (style.type !== 'paragraph') return false;
    return (style.name && TOC_NAME_RE.test(style.name)) || TOC_ID_RE.test(style.id);
  });
}

function resolveSpacing(levels) {
  const line = numeric(pickAttribute(levels, 'spacing', 'line'));
  const lineRule = pickAttribute(levels, 'spacing', 'lineRule');
  if (line === null) {
    if (lineRule && lineRule !== 'auto') {
      return { value: null, known: false };
    }
    // Word по умолчанию рисует одинарный интервал.
    return { value: 1, known: true };
  }
  if (lineRule && lineRule !== 'auto') {
    return { value: null, known: false };
  }
  const multiple = lineTwipsToMultiple(line);
  if (!Number.isFinite(multiple) || multiple <= 0) return { value: null, known: false };
  return { value: multiple, known: true };
}

function resolveIndent(levels) {
  const hanging = numeric(pickAttribute(levels, 'ind', 'hanging'));
  const hangingChars = numeric(pickAttribute(levels, 'ind', 'hangingChars'));
  const firstLine = numeric(pickAttribute(levels, 'ind', 'firstLine'));
  const firstLineChars = numeric(pickAttribute(levels, 'ind', 'firstLineChars'));

  if (hanging !== null) {
    return { value: -twipsToMm(hanging), known: true };
  }
  if (hangingChars !== null) {
    return { value: null, known: false };
  }
  if (firstLine !== null) {
    return { value: twipsToMm(firstLine), known: true };
  }
  if (firstLineChars !== null) {
    // Отступ в «символах» зависит от метрики шрифта — не угадываем.
    return { value: null, known: false };
  }
  return { value: 0, known: true };
}

function resolveAlignment(levels) {
  const raw = pickAttribute(levels, 'jc', 'val');
  if (raw === null) return { value: 'left', known: true };
  const mapped = ALIGNMENT_MAP[String(raw).toLowerCase()];
  if (!mapped) return { value: null, known: false };
  return { value: mapped, known: true };
}

/**
 * Оформление абзаца (без фрагментов текста).
 * @returns {{
 *   styleId: string|null, styleName: string|null, styleChain: object[],
 *   unknownStyle: boolean, isHeading: boolean, isToc: boolean,
 *   paragraph: {alignment:{value:string|null,known:boolean},
 *     lineSpacing:{value:number|null,known:boolean},
 *     firstLine:{value:number|null,known:boolean}},
 *   _pPr: object|null, _paragraphRPr: object|null, _runLevels: object[]
 * }}
 */
export function resolveParagraphStyle(paragraphElement, context) {
  const pPr = firstChild(paragraphElement, 'pPr');
  const pStyleElement = pPr ? firstChild(pPr, 'pStyle') : null;
  const explicitStyleId = pStyleElement ? getAttr(pStyleElement, 'val') : null;

  let chainInfo;
  let unknownStyle = false;

  if (explicitStyleId) {
    const style = context.styles.get(explicitStyleId);
    if (!style || style.type !== 'paragraph') {
      unknownStyle = true;
      chainInfo = { chain: [], incomplete: true };
    } else {
      chainInfo = resolveStyleChain(context, explicitStyleId);
    }
  } else if (context.defaultParagraphStyleId) {
    chainInfo = resolveStyleChain(context, context.defaultParagraphStyleId);
  } else {
    chainInfo = { chain: [], incomplete: false };
  }

  if (chainInfo.incomplete) unknownStyle = true;

  const chain = chainInfo.chain;
  const pPrLevels = [context.docDefaults.pPr, ...chain.map((style) => style.pPr), pPr].filter(Boolean);

  const outlineLevelRaw = pickAttribute(pPrLevels, 'outlineLvl', 'val');
  const outlineLevel = outlineLevelRaw === null ? null : Number(outlineLevelRaw);

  const alignment = resolveAlignment(pPrLevels);
  const lineSpacing = resolveSpacing(pPrLevels);
  const firstLine = resolveIndent(pPrLevels);

  const lastStyle = chain.length > 0 ? chain[chain.length - 1] : null;
  const styleId = explicitStyleId || (lastStyle ? lastStyle.id : null);
  const styleName = lastStyle ? lastStyle.name : null;

  const paragraphRPr = pPr ? firstChild(pPr, 'rPr') : null;
  const runLevels = [
    context.docDefaults.rPr,
    ...chain.map((style) => style.rPr),
    paragraphRPr,
  ].filter(Boolean);

  return {
    styleId,
    styleName,
    styleChain: chain,
    unknownStyle,
    isHeading: detectHeading(chain, outlineLevel),
    isToc: detectToc(chain),
    paragraph: { alignment, lineSpacing, firstLine },
    _pPr: pPr,
    _paragraphRPr: paragraphRPr,
    _runLevels: runLevels,
  };
}

function resolveFontSlot(levels, theme, themeAttribute, plainAttribute) {
  for (let index = levels.length - 1; index >= 0; index -= 1) {
    const fonts = firstChild(levels[index], 'rFonts');
    if (!fonts) continue;
    const themeReference = getAttr(fonts, themeAttribute);
    if (themeReference) {
      const name = themeFontName(theme, themeReference);
      if (name) return name;
    }
    const plain = getAttr(fonts, plainAttribute);
    if (plain) return plain;
  }
  return null;
}

function resolveFontSize(levels) {
  for (let index = levels.length - 1; index >= 0; index -= 1) {
    const sizeElement = firstChild(levels[index], 'sz');
    if (!sizeElement) continue;
    const size = getAttr(sizeElement, 'val');
    if (size !== null && size !== undefined && size !== '') {
      const halfPoints = Number(size);
      if (Number.isFinite(halfPoints) && halfPoints > 0) {
        return { value: halfPointsToPt(halfPoints), known: true };
      }
      return { value: null, known: false };
    }
  }
  return { value: null, known: false };
}

function resolveCharacterStyleRPr(runRPr, context) {
  if (!runRPr) return [];
  const styleElement = firstChild(runRPr, 'rStyle');
  const styleId = styleElement ? getAttr(styleElement, 'val') : null;
  if (!styleId) return [];
  const style = context.styles.get(styleId);
  if (!style || style.type !== 'character') return [];
  const chainInfo = resolveStyleChain(context, styleId);
  return chainInfo.chain.map((item) => item.rPr).filter(Boolean);
}

/**
 * Итоговый шрифт и кегль фрагмента (run) с учётом стилей абзаца
 * и символьного стиля (w:rStyle).
 * @returns {{fontFamily:string|null, fontKnown:boolean,
 *   fontSizePt:number|null, sizeKnown:boolean}}
 */
export function resolveRunFormatting(runElement, paragraphInfo, context) {
  const runRPr = firstChild(runElement, 'rPr');
  const characterRPrs = resolveCharacterStyleRPr(runRPr, context);
  const levels = [...paragraphInfo._runLevels, ...characterRPrs, runRPr].filter(Boolean);

  const ascii = resolveFontSlot(levels, context.theme, 'asciiTheme', 'ascii');
  const hAnsi = resolveFontSlot(levels, context.theme, 'hAnsiTheme', 'hAnsi');
  const complexScript = resolveFontSlot(levels, context.theme, 'csTheme', 'cs');
  const fontFamily = hAnsi || ascii || complexScript;

  const size = resolveFontSize(levels);
  return {
    fontFamily: fontFamily || null,
    fontKnown: Boolean(fontFamily),
    fontSizePt: size.value,
    sizeKnown: size.known,
  };
}
