import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseXml, firstChild } from '../assets/js/xml.js';
import {
  buildStyleContext,
  resolveParagraphStyle,
  resolveRunFormatting,
} from '../assets/js/style-resolver.js';
import {
  documentXml,
  p,
  stylesXml,
  style,
  themeXml,
} from './helpers/ooxml.mjs';

function setup(body, { docRPr = '', docPPr = '', styles = '' } = {}, theme = null) {
  const context = buildStyleContext({
    stylesXml: stylesXml({ docRPr, docPPr, styles }),
    themeXml: theme ? themeXml(theme) : null,
  });
  const document = parseXml(documentXml(body));
  const bodyElement = firstChild(document.documentElement, 'body');
  const paragraphElement = firstChild(bodyElement, 'p');
  const info = resolveParagraphStyle(paragraphElement, context);
  return { context, paragraphElement, info };
}

function firstRun(paragraphElement) {
  return firstChild(paragraphElement, 'r');
}

function formatFirstRun(setupResult) {
  return resolveRunFormatting(
    firstRun(setupResult.paragraphElement),
    setupResult.info,
    setupResult.context,
  );
}

test('docDefaults и стиль по умолчанию дают шрифт из темы, кегль и интервал', () => {
  const result = setup(
    p('Текст', { style: 'MainText' }),
    {
      docRPr: '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="28"/>',
      docPPr: '<w:spacing w:line="360" w:lineRule="auto"/><w:jc w:val="both"/>',
      styles: style({ id: 'Normal', isDefault: true, pPr: '<w:ind w:firstLine="708"/>' })
        + style({ id: 'MainText', name: 'Main Text', basedOn: 'Normal' }),
    },
    { minor: 'Times New Roman' },
  );

  assert.equal(result.info.paragraph.alignment.value, 'justify');
  assert.equal(result.info.paragraph.alignment.known, true);
  assert.equal(result.info.paragraph.lineSpacing.value, 1.5);
  assert.ok(Math.abs(result.info.paragraph.firstLine.value - 12.5) < 0.05);

  const runFormat = formatFirstRun(result);
  assert.equal(runFormat.fontFamily, 'Times New Roman');
  assert.equal(runFormat.fontKnown, true);
  assert.equal(runFormat.fontSizePt, 14);
  assert.equal(runFormat.sizeKnown, true);
});

test('цепочка basedOn и прямое форматирование run перекрывают стили', () => {
  const result = setup(
    p('Текст', {
      style: 'MainText',
      rPr: '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/>',
    }),
    {
      docRPr: '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="28"/>',
      styles: style({ id: 'Normal', isDefault: true })
        + style({
          id: 'MainText',
          basedOn: 'Normal',
          rPr: '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="24"/>',
        }),
    },
  );

  const runFormat = formatFirstRun(result);
  assert.equal(runFormat.fontFamily, 'Arial');
  assert.equal(runFormat.fontSizePt, 10);
});

test('прямое форматирование абзаца (pPr/rPr) действует, если у run нет своего', () => {
  const result = setup(
    p('Текст', {
      style: 'MainText',
      pPr: '<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="26"/></w:rPr>',
    }),
    {
      docRPr: '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="28"/>',
      styles: style({ id: 'MainText', isDefault: true }),
    },
  );

  const runFormat = formatFirstRun(result);
  assert.equal(runFormat.fontFamily, 'Georgia');
  assert.equal(runFormat.fontSizePt, 13);
});

test('шрифт из темы для кириллицы берётся из script="Cyrl"', () => {
  const result = setup(
    p('Текст'),
    {
      docRPr: '<w:rFonts w:hAnsiTheme="minorHAnsi"/><w:sz w:val="28"/>',
      styles: style({ id: 'Normal', isDefault: true }),
    },
    { minor: 'Calibri', cyrillic: 'Times New Roman' },
  );

  assert.equal(formatFirstRun(result).fontFamily, 'Times New Roman');
});

test('прямой ascii у run перекрывает тему, унаследованную из стиля', () => {
  const result = setup(
    p('Текст', { rPr: '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>' }),
    {
      docRPr: '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="28"/>',
      styles: style({ id: 'Normal', isDefault: true }),
    },
    { minor: 'Times New Roman' },
  );

  assert.equal(formatFirstRun(result).fontFamily, 'Arial');
});

test('отсутствующая тема или неизвестный шрифт помечаются unknown, а не ошибкой', () => {
  const result = setup(
    p('Текст'),
    {
      docRPr: '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="28"/>',
      styles: style({ id: 'Normal', isDefault: true }),
    },
    null,
  );

  const runFormat = formatFirstRun(result);
  assert.equal(runFormat.fontKnown, false);
  assert.equal(runFormat.fontFamily, null);
});

test('интервал exact/atLeast и отступ в символах не угадываются', () => {
  const exact = setup(
    p('Текст', { pPr: '<w:spacing w:line="600" w:lineRule="exact"/><w:ind w:firstLineChars="250"/>' }),
    { styles: style({ id: 'Normal', isDefault: true }) },
  );
  assert.equal(exact.info.paragraph.lineSpacing.known, false);
  assert.equal(exact.info.paragraph.lineSpacing.value, null);
  assert.equal(exact.info.paragraph.firstLine.known, false);
  assert.equal(exact.info.paragraph.firstLine.value, null);
});

test('выступ (hanging) даёт отрицательный отступ', () => {
  const result = setup(
    p('Текст', { pPr: '<w:ind w:hanging="709"/>' }),
    { styles: style({ id: 'Normal', isDefault: true }) },
  );
  assert.equal(result.info.paragraph.firstLine.known, true);
  assert.ok(Math.abs(result.info.paragraph.firstLine.value + 12.5) < 0.01);
});

test('выравнивание нормализуется: start→left, distribute→justify, мусор→unknown', () => {
  const start = setup(
    p('Текст', { pPr: '<w:jc w:val="start"/>' }),
    { styles: style({ id: 'Normal', isDefault: true }) },
  );
  assert.equal(start.info.paragraph.alignment.value, 'left');

  const distribute = setup(
    p('Текст', { pPr: '<w:jc w:val="distribute"/>' }),
    { styles: style({ id: 'Normal', isDefault: true }) },
  );
  assert.equal(distribute.info.paragraph.alignment.value, 'justify');

  const broken = setup(
    p('Текст', { pPr: '<w:jc w:val="sideways"/>' }),
    { styles: style({ id: 'Normal', isDefault: true }) },
  );
  assert.equal(broken.info.paragraph.alignment.known, false);
});

test('без явного выравнивания действует Word-значение по левому краю', () => {
  const result = setup(p('Текст'), { styles: style({ id: 'Normal', isDefault: true }) });
  assert.equal(result.info.paragraph.alignment.value, 'left');
  assert.equal(result.info.paragraph.alignment.known, true);
});

test('без явного интервала действует одинарный', () => {
  const result = setup(p('Текст'), { styles: style({ id: 'Normal', isDefault: true }) });
  assert.equal(result.info.paragraph.lineSpacing.value, 1);
  assert.equal(result.info.paragraph.lineSpacing.known, true);
});

test('заголовки распознаются по outlineLvl и имени стиля, оглавление — по стилю', () => {
  const byOutline = setup(
    p('Заголовок', { pPr: '<w:outlineLvl w:val="0"/>' }),
    { styles: style({ id: 'Normal', isDefault: true }) },
  );
  assert.equal(byOutline.info.isHeading, true);

  const byName = setup(
    p('Заголовок', { style: 'MyHeading' }),
    { styles: style({ id: 'MyHeading', name: 'heading 2', basedOn: 'Normal' }) },
  );
  assert.equal(byName.info.isHeading, true);

  const toc = setup(
    p('Содержание', { style: 'MyToc' }),
    { styles: style({ id: 'MyToc', name: 'toc 1', basedOn: 'Normal' }) },
  );
  assert.equal(toc.info.isToc, true);
  assert.equal(toc.info.isHeading, false);
});

test('неизвестный стиль, отсутствующий родитель и цикл basedOn помечаются unknown', () => {
  const missing = setup(
    p('Текст', { style: 'NoSuchStyle' }),
    { styles: style({ id: 'Normal', isDefault: true }) },
  );
  assert.equal(missing.info.unknownStyle, true);

  const brokenParent = setup(
    p('Текст', { style: 'Child' }),
    { styles: style({ id: 'Child', basedOn: 'NoParent' }) },
  );
  assert.equal(brokenParent.info.unknownStyle, true);

  const cycle = setup(
    p('Текст', { style: 'A' }),
    { styles: style({ id: 'A', basedOn: 'B' }) + style({ id: 'B', basedOn: 'A' }) },
  );
  assert.equal(cycle.info.unknownStyle, true);
});

test('szCs не подменяет обычный размер шрифта', () => {
  const result = setup(
    p('Текст', { rPr: '<w:szCs w:val="28"/>' }),
    { styles: style({ id: 'Normal', isDefault: true }) },
  );
  assert.equal(formatFirstRun(result).sizeKnown, false);
});

test('символьный стиль (w:rStyle) перекрывает стиль абзаца и учитывает basedOn', () => {
  const result = setup(
    p('Текст', { rPr: '<w:rStyle w:val="Emphasis"/>' }),
    {
      docRPr: '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="28"/>',
      styles: style({ id: 'Normal', isDefault: true })
        + style({
          id: 'BaseChar',
          type: 'character',
          name: 'Base Char',
          rPr: '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/>',
        })
        + style({
          id: 'Emphasis',
          type: 'character',
          name: 'Emphasis',
          basedOn: 'BaseChar',
          rPr: '<w:sz w:val="24"/>',
        }),
    },
  );

  const runFormat = formatFirstRun(result);
  assert.equal(runFormat.fontFamily, 'Arial');
  assert.equal(runFormat.fontSizePt, 12);
});

test('прямое форматирование run перекрывает символьный стиль', () => {
  const result = setup(
    p('Текст', {
      rPr: '<w:rStyle w:val="Emphasis"/><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="28"/>',
    }),
    {
      docRPr: '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="28"/>',
      styles: style({ id: 'Normal', isDefault: true })
        + style({
          id: 'Emphasis',
          type: 'character',
          rPr: '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/>',
        }),
    },
  );

  const runFormat = formatFirstRun(result);
  assert.equal(runFormat.fontFamily, 'Georgia');
  assert.equal(runFormat.fontSizePt, 14);
});
