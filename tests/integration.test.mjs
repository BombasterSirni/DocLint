import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkDocument,
  MAX_FILE_BYTES,
  PROGRESS,
} from '../assets/js/file-reader.js';
import { buildDemoDocx } from '../assets/js/demo.js';
import { DocLintError, ERROR_CODES } from '../assets/js/errors.js';
import { BUILTIN_PROFILES } from '../assets/js/presets.js';
import {
  JSZip,
  documentXml,
  p,
  stylesXml,
  style,
  sectPr,
  packageParts,
  buildDocx,
  makeDocxFile,
  testProfile,
} from './helpers/ooxml.mjs';

globalThis.JSZip = JSZip;

const DEMO_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function validStyles() {
  return stylesXml({
    docRPr: '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="28"/>',
    docPPr: '<w:spacing w:line="360" w:lineRule="auto"/><w:jc w:val="both"/>',
    styles: style({ id: 'Normal', isDefault: true, pPr: '<w:ind w:firstLine="708"/>' }),
  });
}

function validDocument() {
  return documentXml(p('Корректный абзац основного текста.'), { sectPr: sectPr() });
}

async function validFile() {
  return makeDocxFile(validDocument(), validStyles());
}

function expectCode(code) {
  return (error) => error instanceof DocLintError && error.code === code;
}

test('checkDocument возвращает отчёт по контракту и сообщает прогресс', async () => {
  const stages = [];
  const report = await checkDocument(await validFile(), testProfile(), {
    onProgress: (stage) => stages.push(stage),
  });

  assert.equal(report.totalChecked, 1);
  assert.equal(report.skippedCount, 0);
  assert.equal(report.uncheckedCount, 0);
  assert.deepEqual(report.violations, []);
  assert.deepEqual(report.countsByRule, {});
  assert.deepEqual(stages, [
    PROGRESS.READ,
    PROGRESS.UNPACK,
    PROGRESS.PARSE,
    PROGRESS.CHECK,
    PROGRESS.DONE,
  ]);
});

test('демонстрационный .docx даёт ожидаемые нарушения и группировку', async () => {
  const bytes = await buildDemoDocx(JSZip, 'uint8array');
  const file = new File([bytes], 'demo.docx', { type: DEMO_MIME });
  const report = await checkDocument(file, BUILTIN_PROFILES[0]);

  assert.equal(report.totalChecked, 8);
  assert.equal(report.skippedCount, 7);
  assert.equal(report.uncheckedCount, 0);
  assert.equal(report.violations.length, 21);
  assert.deepEqual(report.countsByRule, {
    'margin.left': 1,
    'margin.right': 1,
    'margin.top': 1,
    'margin.bottom': 1,
    'font.family': 4,
    'font.size': 3,
    'spacing.line': 4,
    'indent.firstLine': 3,
    alignment: 3,
  });
  assert.ok(report.violations.every((item) => item.hint && item.expected));
});

test('пресет методички с кеглем 14 добавляет нарушение кегля', async () => {
  const bytes = await buildDemoDocx(JSZip, 'uint8array');
  const file = new File([bytes], 'demo.docx', { type: DEMO_MIME });
  const report = await checkDocument(file, BUILTIN_PROFILES[1]);
  assert.equal(report.violations.length, 22);
  assert.equal(report.countsByRule['font.size'], 4);
});

test('профиль не мутируется и встроенные пресеты защищены', async () => {
  const before = JSON.stringify(BUILTIN_PROFILES[0]);
  await checkDocument(await validFile(), BUILTIN_PROFILES[0]);
  assert.equal(JSON.stringify(BUILTIN_PROFILES[0]), before);
});

test('неподдерживаемое расширение даёт INVALID_FILE с понятным сообщением', async () => {
  await assert.rejects(
    checkDocument(new File([new Uint8Array(10)], 'old.doc'), testProfile()),
    (error) => {
      assert.ok(expectCode(ERROR_CODES.INVALID_FILE)(error));
      assert.match(error.message, /\.docx/);
      return true;
    },
  );
  await assert.rejects(
    checkDocument(new File([new Uint8Array(10)], 'note.txt'), testProfile()),
    expectCode(ERROR_CODES.INVALID_FILE),
  );
});

test('файл больше лимита отклоняется до распаковки', async () => {
  const huge = { name: 'huge.docx', size: MAX_FILE_BYTES + 1 };
  await assert.rejects(
    checkDocument(huge, testProfile()),
    (error) => {
      assert.ok(expectCode(ERROR_CODES.FILE_TOO_LARGE)(error));
      assert.match(error.message, /20 МБ/);
      return true;
    },
  );
});

test('пустой и повреждённый ZIP дают INVALID_DOCX', async () => {
  await assert.rejects(
    checkDocument(new File([new Uint8Array(0)], 'empty.docx'), testProfile()),
    expectCode(ERROR_CODES.INVALID_DOCX),
  );
  await assert.rejects(
    checkDocument(new File([new Uint8Array([1, 2, 3, 4])], 'broken.docx'), testProfile()),
    expectCode(ERROR_CODES.INVALID_DOCX),
  );
});

test('ZIP без word/document.xml даёт INVALID_DOCX', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  await assert.rejects(
    checkDocument(new File([bytes], 'nodoc.docx'), testProfile()),
    (error) => {
      assert.ok(expectCode(ERROR_CODES.INVALID_DOCX)(error));
      assert.match(error.message, /document\.xml/);
      return true;
    },
  );
});

test('битый document.xml даёт INVALID_DOCX, а не падение', async () => {
  const parts = packageParts({
    document: '<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body>',
    styles: validStyles(),
  });
  const bytes = await buildDocx(parts);
  await assert.rejects(
    checkDocument(new File([bytes], 'badxml.docx'), testProfile()),
    expectCode(ERROR_CODES.INVALID_DOCX),
  );
});

test('невалидный профиль останавливает проверку до чтения файла', async () => {
  await assert.rejects(
    checkDocument(new File([new Uint8Array(10)], 'x.docx'), { id: 'broken' }),
    (error) => {
      assert.ok(expectCode(ERROR_CODES.INVALID_PROFILE)(error));
      assert.ok(Array.isArray(error.details));
      return true;
    },
  );
});

test('без theme1.xml шрифт из темы считается непроверенным, а не ошибкой', async () => {
  const styles = stylesXml({
    docRPr: '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="28"/>',
    docPPr: '<w:spacing w:line="360" w:lineRule="auto"/><w:jc w:val="both"/>',
    styles: style({ id: 'Normal', isDefault: true, pPr: '<w:ind w:firstLine="708"/>' }),
  });
  const file = await makeDocxFile(documentXml(p('Текст'), { sectPr: sectPr() }), styles);
  const report = await checkDocument(file, testProfile());
  assert.equal(report.violations.length, 0);
  assert.equal(report.uncheckedCount, 1);
});

test('без styles.xml документ проверяется по word-умолчаниям без падения', async () => {
  const parts = packageParts({
    document: documentXml(p('Текст'), { sectPr: sectPr() }),
    styles: validStyles(),
  });
  delete parts['word/styles.xml'];
  const bytes = await buildDocx(parts);
  const report = await checkDocument(
    new File([bytes], 'nostyles.docx'),
    testProfile(),
  );

  assert.ok(report.uncheckedCount >= 2);
  assert.ok(!report.violations.some((item) => item.ruleId === 'font.family'));
  assert.ok(!report.violations.some((item) => item.ruleId === 'font.size'));
});

test('Report содержит summary из модели данных', async () => {
  const report = await checkDocument(await validFile(), testProfile());
  assert.equal(report.summary, 'Нарушений не найдено в проверяемых правилах.');

  const bytes = await buildDemoDocx(JSZip, 'uint8array');
  const demo = await checkDocument(new File([bytes], 'demo.docx', { type: DEMO_MIME }), BUILTIN_PROFILES[0]);
  assert.equal(demo.summary, '21 нарушение в 6 категориях');
});
