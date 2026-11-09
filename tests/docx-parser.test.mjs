import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildStyleContext } from '../assets/js/style-resolver.js';
import { parseDocumentXml, extractPageMargins } from '../assets/js/docx-parser.js';
import {
  documentXml,
  p,
  run,
  stylesXml,
  style,
  sectPr,
  escapeXml,
} from './helpers/ooxml.mjs';

function context() {
  return buildStyleContext({
    stylesXml: stylesXml({
      docRPr: '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="28"/>',
      docPPr: '<w:spacing w:line="360" w:lineRule="auto"/><w:jc w:val="both"/>',
      styles: style({ id: 'Normal', isDefault: true, pPr: '<w:ind w:firstLine="708"/>' })
        + style({
          id: 'Heading1',
          name: 'heading 1',
          basedOn: 'Normal',
          pPr: '<w:outlineLvl w:val="0"/>',
          rPr: '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>',
        })
        + style({ id: 'TOC1', name: 'toc 1', basedOn: 'Normal' }),
    }),
  });
}

function parseBody(body, margins = sectPr()) {
  return parseDocumentXml(documentXml(body, { sectPr: margins }), context());
}

test('титульный лист пропускается до первого явного разрыва страницы', () => {
  const parsed = parseBody(
    p('Титул 1') + p('Титул 2', { pageBreak: true }) + p('Основной 1') + p('Основной 2'),
  );
  assert.deepEqual(
    parsed.paragraphs.map((record) => record.skippedReason),
    ['title', 'title', null, null],
  );
  assert.deepEqual(
    parsed.paragraphs.map((record) => record.index),
    [1, 2, 3, 4],
  );
});

test('разрыв раздела в pPr также закрывает титульный лист', () => {
  const parsed = parseBody(
    p('Титул', { pPr: '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>' }) + p('Основной'),
  );
  assert.equal(parsed.paragraphs[0].skippedReason, 'title');
  assert.equal(parsed.paragraphs[1].skippedReason, null);
});

test('разрыв страницы внутри hyperlink учитывается', () => {
  const titleRuns = '<w:hyperlink><w:r><w:br w:type="page"/></w:r></w:hyperlink>';
  const parsed = parseBody(p('', { rawRuns: titleRuns }) + p('Основной'));
  assert.equal(parsed.paragraphs[0].skippedReason, 'title');
  assert.equal(parsed.paragraphs[1].skippedReason, null);
});

test('заголовки по стилю и outlineLvl, оглавление по стилю пропускаются', () => {
  const parsed = parseBody(
    p('1 Введение', { style: 'Heading1' })
      + p('Прямой заголовок', { pPr: '<w:outlineLvl w:val="1"/>' })
      + p('Содержание', { style: 'TOC1' })
      + p('Обычный текст'),
  );
  assert.deepEqual(
    parsed.paragraphs.map((record) => record.skippedReason),
    ['heading', 'heading', 'toc', null],
  );
});

test('оглавление-поле TOC распознаётся по fldSimple и instrText', () => {
  const simple = p('', {
    rawRuns: '<w:fldSimple w:instr=" TOC \\o &quot;1-3&quot; "><w:r><w:t>Оглавление</w:t></w:r></w:fldSimple>',
  });
  const instr = p('', {
    rawRuns: '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
      + '<w:r><w:instrText> TOC \\o "1-3" </w:instrText></w:r>'
      + '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Список</w:t></w:r>',
  });
  const parsed = parseBody(simple + instr + p('Обычный текст'));
  assert.deepEqual(
    parsed.paragraphs.map((record) => record.skippedReason),
    ['toc', 'toc', null],
  );
});

test('outlineLvl=9 — не заголовок', () => {
  const parsed = parseBody(p('Обычный', { pPr: '<w:outlineLvl w:val="9"/>' }));
  assert.equal(parsed.paragraphs[0].skippedReason, null);
});

test('абзацы в таблице пропускаются и сохраняют сквозную нумерацию', () => {
  const table = `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>`
    + p('Ячейка 1') + p('Ячейка 2') + '</w:tc></w:tr></w:tbl>';
  const parsed = parseBody(p('До таблицы') + table + p('После таблицы'));
  assert.deepEqual(
    parsed.paragraphs.map((record) => record.skippedReason),
    [null, 'table', 'table', null],
  );
  assert.deepEqual(
    parsed.paragraphs.map((record) => record.index),
    [1, 2, 3, 4],
  );
});

test('пустые абзацы и абзацы из пробелов пропускаются', () => {
  const parsed = parseBody(p('Текст') + p('') + p('   ') + p('Ещё текст'));
  assert.deepEqual(
    parsed.paragraphs.map((record) => record.skippedReason),
    [null, 'empty', 'empty', null],
  );
});

test('неизвестный стиль помечается unknown-style, а не проверяется наугад', () => {
  const parsed = parseBody(p('Текст', { style: 'NoSuchStyle' }) + p('Обычный'));
  assert.equal(parsed.paragraphs[0].skippedReason, 'unknown-style');
  assert.equal(parsed.paragraphs[0].properties, null);
  assert.equal(parsed.paragraphs[1].skippedReason, null);
});

test('поля страницы читаются из финального sectPr и допускают отсутствие pgMar', () => {
  const parsed = parseBody(p('Текст'), sectPr({ left: 30, right: 15, top: 20, bottom: 20 }));
  assert.ok(Math.abs(parsed.pageMargins.left - 30) < 0.01);
  assert.ok(Math.abs(parsed.pageMargins.right - 15) < 0.01);
  assert.ok(Math.abs(parsed.pageMargins.top - 20) < 0.01);
  assert.ok(Math.abs(parsed.pageMargins.bottom - 20) < 0.01);

  const noPgMar = parseDocumentXml(
    documentXml(p('Текст'), { sectPr: '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>' }),
    context(),
  );
  assert.deepEqual(noPgMar.pageMargins, { left: null, right: null, top: null, bottom: null });

  const noSectPr = parseDocumentXml(documentXml(p('Текст')), context());
  assert.deepEqual(noSectPr.pageMargins, { left: null, right: null, top: null, bottom: null });
});

test('extractPageMargins не падает без body', () => {
  assert.deepEqual(extractPageMargins(null), { left: null, right: null, top: null, bottom: null });
});

test('preview схлопывает пробелы и обрезает длинный текст по слову', () => {
  const short = parseBody(p('  Первое    слово\n второе  '));
  assert.equal(short.paragraphs[0].preview, 'Первое слово второе');

  const longText = `${'слово '.repeat(30)}конец`;
  const long = parseBody(p(longText));
  assert.ok(long.paragraphs[0].preview.endsWith('…'));
  assert.ok(long.paragraphs[0].preview.length <= 91);
  assert.ok(!long.paragraphs[0].preview.includes('  '));
});

test('текст внутри текстового поля не попадает в абзац', () => {
  const withTextbox = p('Видимый', {
    rawRuns: run('Видимый')
      + '<w:r><w:drawing><w:txbxContent>'
      + `<w:p><w:r><w:t>${escapeXml('Скрытый')}</w:t></w:r></w:p>`
      + '</w:txbxContent></w:drawing></w:r>',
  });
  const parsed = parseBody(withTextbox);
  assert.equal(parsed.paragraphs[0].preview, 'Видимый');
});

test('несколько runs сохраняются с собственным шрифтом и кеглем', () => {
  const mixed = p('', {
    rawRuns: run('Первый', { rPr: '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/>' })
      + run(' ', { rPr: '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="24"/>' })
      + run('Второй', { rPr: '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="24"/>' }),
  });
  const parsed = parseBody(mixed);
  const runs = parsed.paragraphs[0].properties.runs;
  assert.equal(runs.length, 2);
  assert.equal(runs[0].fontFamily, 'Arial');
  assert.equal(runs[0].fontSizePt, 10);
  assert.equal(runs[1].fontFamily, 'Calibri');
  assert.equal(runs[1].fontSizePt, 12);
});

test('пустой styles.xml не ломает разбор, но оформление остаётся неизвестным', () => {
  const ctx = buildStyleContext({ stylesXml: null });
  const parsed = parseDocumentXml(documentXml(p('Текст') + p('Ещё')), ctx);
  assert.equal(parsed.paragraphs.length, 2);
  assert.equal(parsed.paragraphs[0].properties.runs[0].fontKnown, false);
  assert.equal(parsed.paragraphs[0].properties.runs[0].sizeKnown, false);
});

test('document.xml без body считается повреждённым', () => {
  const broken = '<?xml version="1.0"?><w:document xmlns:w="urn:w"/>';
  assert.throws(() => parseDocumentXml(broken, context()), /w:body/);
});

test('заголовок не проверяется даже при прямом форматировании', () => {
  const parsed = parseBody(
    p('Заголовок', {
      style: 'Heading1',
      rPr: '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/>',
    }) + p('Обычный'),
  );
  assert.equal(parsed.paragraphs[0].skippedReason, 'heading');
  assert.equal(parsed.paragraphs[0].properties, null);
});

test('pageBreakBefore закрывает титульный лист до самого абзаца', () => {
  const parsed = parseBody(
    p('Титул') + p('Основной с новой страницы', { pPr: '<w:pageBreakBefore/>' }) + p('Следующий'),
  );
  assert.deepEqual(
    parsed.paragraphs.map((record) => record.skippedReason),
    ['title', null, null],
  );
});

test('pageBreakBefore="0" не считается разрывом', () => {
  const parsed = parseBody(
    p('Первый') + p('Второй', { pPr: '<w:pageBreakBefore w:val="0"/>' }),
  );
  assert.deepEqual(
    parsed.paragraphs.map((record) => record.skippedReason),
    [null, null],
  );
});

test('непрерывный разрыв раздела не закрывает титульный лист', () => {
  const continuous = p('Титул 2', {
    pPr: '<w:sectPr><w:type w:val="continuous"/></w:sectPr>',
  });
  const parsed = parseBody(
    p('Титул 1') + continuous + p('Титул 3', { pageBreak: true }) + p('Основной'),
  );
  assert.deepEqual(
    parsed.paragraphs.map((record) => record.skippedReason),
    ['title', 'title', 'title', null],
  );
});

test('sectionIndex увеличивается после разрыва раздела и учитывает таблицы', () => {
  const table = `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>`
    + p('Ячейка 1') + p('Ячейка 2') + '</w:tc></w:tr></w:tbl>';
  const parsed = parseBody(
    p('Раздел 1') + p('Конец раздела', {
      pPr: '<w:sectPr><w:type w:val="nextPage"/></w:sectPr>',
    }) + p('Раздел 2') + table + p('Ещё раздел 2'),
  );
  assert.deepEqual(
    parsed.paragraphs.map((record) => record.sectionIndex),
    [0, 0, 1, 1, 1, 1],
  );
  assert.equal(parsed.sectionCount, 2);
});

test('непрерывный разрыв раздела тоже создаёт новый sectionIndex', () => {
  const parsed = parseBody(
    p('Раздел 1') + p('Конец', {
      pPr: '<w:sectPr><w:type w:val="continuous"/></w:sectPr>',
    }) + p('Раздел 2'),
  );
  assert.deepEqual(
    parsed.paragraphs.map((record) => record.sectionIndex),
    [0, 0, 1],
  );
  assert.equal(parsed.sectionCount, 2);
});
