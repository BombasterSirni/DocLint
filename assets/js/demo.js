/**
 * Демонстрационный .docx с намеренными ошибками. Собирается в памяти
 * из XML-частей, поэтому «Проверить пример» работает без сети.
 */

export const DEMO_FILE_NAME = 'doclint-example.docx';
export const DEMO_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const RPR_CALIBRI_11 = '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
  + '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>';
const RPR_ARIAL_14 = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>'
  + '<w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>';
const RPR_TIMES_12 = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>'
  + '<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>';

const PPR_SINGLE_LEFT_NOINDENT = '<w:spacing w:line="240" w:lineRule="auto"/>'
  + '<w:ind w:firstLine="0"/><w:jc w:val="left"/>';

function paragraph(text, { pPr = '', rPr = '', style = null, pageBreak = false } = {}) {
  const pStyle = style ? `<w:pStyle w:val="${escapeXml(style)}"/>` : '';
  const breakElement = pageBreak ? '<w:br w:type="page"/>' : '';
  const run = `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t>${breakElement}</w:r>`;
  return `<w:p>${pPr || pStyle ? `<w:pPr>${pStyle}${pPr}</w:pPr>` : ''}${run}</w:p>`;
}

function tableCell(text) {
  return '<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>'
    + paragraph(text, { pPr: PPR_SINGLE_LEFT_NOINDENT, rPr: RPR_CALIBRI_11 })
    + '</w:tc>';
}

function table() {
  return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>'
    + '<w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>'
    + '<w:tr>' + tableCell('Ячейка таблицы с чужим шрифтом') + tableCell('Вторая ячейка') + '</w:tr>'
    + '</w:tbl>';
}

export function buildDemoDocumentXml() {
  const body = [
    // Титульный лист: до первого явного разрыва страницы всё пропускается.
    paragraph('Министерство науки и высшего образования Российской Федерации', {
      pPr: PPR_SINGLE_LEFT_NOINDENT,
      rPr: RPR_CALIBRI_11,
    }),
    paragraph('Курсовая работа: проверка оформления', {
      pPr: '<w:jc w:val="center"/>',
      rPr: '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="40"/></w:rPr>',
      pageBreak: true,
    }),
    // Заголовок и оглавление вне MVP.
    paragraph('1 Обзор литературы', { style: 'Heading1' }),
    paragraph('Содержание', { style: 'TOC1' }),
    // Корректный абзац: Times New Roman 14 через тему, 1,5, отступ 1,25 см, по ширине.
    paragraph(
      'Настоящая работа посвящена проверке оформления учебных документов. '
      + 'Все параметры этого абзаца соответствуют профилю ГОСТ.',
      { style: 'MainText' },
    ),
    // Три соседних абзаца с одинаковыми нарушениями — для группировки.
    paragraph('В данной главе рассматриваются основные подходы к оформлению текста.', {
      style: 'MainText', pPr: PPR_SINGLE_LEFT_NOINDENT, rPr: RPR_CALIBRI_11,
    }),
    paragraph('Первый подход опирается на ручную сверку параметров каждого абзаца.', {
      style: 'MainText', pPr: PPR_SINGLE_LEFT_NOINDENT, rPr: RPR_CALIBRI_11,
    }),
    paragraph('Второй подход использует шаблон, но не находит ошибок в готовом документе.', {
      style: 'MainText', pPr: PPR_SINGLE_LEFT_NOINDENT, rPr: RPR_CALIBRI_11,
    }),
    // Только шрифт.
    paragraph('Этот абзац набран шрифтом Arial, остальные параметры верны.', {
      style: 'MainText', rPr: RPR_ARIAL_14,
    }),
    // Только кегль: 12 пт допустим по ГОСТ, но не по методичке с кеглем 14.
    paragraph('Этот абзац набран кеглем 12 пунктов вместо 14.', {
      style: 'MainText', rPr: RPR_TIMES_12,
    }),
    // Только интервал.
    paragraph('У этого абзаца одинарный интервал, остальное оформлено верно.', {
      style: 'MainText',
      pPr: '<w:spacing w:line="240" w:lineRule="auto"/>',
    }),
    // Пустой абзац с «чужим» форматированием — пропускается.
    paragraph(' ', { style: 'MainText', pPr: PPR_SINGLE_LEFT_NOINDENT, rPr: RPR_CALIBRI_11 }),
    // Таблица — пропускается целиком.
    table(),
    // Финальный корректный абзац.
    paragraph('Выводы по главе приведены в конце работы.', { style: 'MainText' }),
  ].join('');

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
    + `<w:body>${body}`
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="850" w:right="567" w:bottom="850" w:left="1134" '
    + 'w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>';
}

function buildStylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + '<w:docDefaults>'
    + '<w:rPrDefault><w:rPr>'
    + '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorBidi"/>'
    + '<w:sz w:val="28"/><w:szCs w:val="28"/><w:lang w:val="ru-RU"/>'
    + '</w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr>'
    + '<w:spacing w:after="0" w:line="360" w:lineRule="auto"/><w:jc w:val="both"/>'
    + '</w:pPr></w:pPrDefault>'
    + '</w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>'
    + '<w:pPr><w:ind w:firstLine="708"/></w:pPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="MainText"><w:name w:val="Main Text"/>'
    + '<w:basedOn w:val="Normal"/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>'
    + '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/><w:jc w:val="left"/>'
    + '<w:ind w:firstLine="0"/></w:pPr>'
    + '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr>'
    + '</w:style>'
    + '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/>'
    + '<w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="left"/><w:ind w:firstLine="0"/></w:pPr>'
    + '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr>'
    + '</w:style>'
    + '</w:styles>';
}

function buildThemeXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="DocLint Demo">'
    + '<a:themeElements>'
    + '<a:fontScheme name="DocLint Demo">'
    + '<a:majorFont><a:latin typeface="Times New Roman"/>'
    + '<a:font script="Cyrl" typeface="Times New Roman"/></a:majorFont>'
    + '<a:minorFont><a:latin typeface="Times New Roman"/>'
    + '<a:font script="Cyrl" typeface="Times New Roman"/></a:minorFont>'
    + '</a:fontScheme>'
    + '</a:themeElements>'
    + '</a:theme>';
}

export function buildDemoDocxParts() {
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + '</Types>';

  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>';

  const documentRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>'
    + '</Relationships>';

  return {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels,
    'word/document.xml': buildDemoDocumentXml(),
    'word/styles.xml': buildStylesXml(),
    'word/theme/theme1.xml': buildThemeXml(),
    'word/_rels/document.xml.rels': documentRels,
  };
}

/**
 * @param {Function} JSZipConstructor
 * @param {'blob'|'uint8array'|'nodebuffer'} type
 */
export async function buildDemoDocx(JSZipConstructor = globalThis.JSZip, type = 'blob') {
  if (typeof JSZipConstructor !== 'function') {
    throw new Error('JSZip не загружен');
  }
  const zip = new JSZipConstructor();
  for (const [path, content] of Object.entries(buildDemoDocxParts())) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type, compression: 'DEFLATE' });
}
