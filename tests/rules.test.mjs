import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkRules, TOLERANCES } from '../assets/js/rules.js';
import { testProfile } from './helpers/ooxml.mjs';

function props({
  fontFamily = 'Times New Roman',
  fontSizePt = 14,
  lineSpacing = 1.5,
  firstLine = 12.5,
  alignment = 'justify',
  fontKnown = true,
  sizeKnown = true,
  lineKnown = true,
  indentKnown = true,
  alignmentKnown = true,
} = {}) {
  return {
    styleId: 'Normal',
    styleName: 'Normal',
    paragraph: {
      alignment: { value: alignment, known: alignmentKnown },
      lineSpacing: { value: lineSpacing, known: lineKnown },
      firstLine: { value: firstLine, known: indentKnown },
    },
    runs: [{
      text: 'Текст',
      fontFamily,
      fontKnown,
      fontSizePt,
      sizeKnown,
    }],
  };
}

function record(index, paragraphProperties, skippedReason = null) {
  return {
    index,
    preview: `Абзац ${index}`,
    sectionIndex: 0,
    skippedReason,
    properties: skippedReason ? null : paragraphProperties,
  };
}

function parsed(paragraphs, pageMargins = { left: 30, right: 15, top: 20, bottom: 20 }) {
  return { paragraphs, pageMargins };
}

test('полностью корректный абзац и поля не дают нарушений', () => {
  const report = checkRules(parsed([record(1, props())]), testProfile());
  assert.equal(report.violations.length, 0);
  assert.equal(report.totalChecked, 1);
  assert.equal(report.skippedCount, 0);
  assert.equal(report.uncheckedCount, 0);
  assert.deepEqual(report.countsByRule, {});
});

test('поля страницы проверяются с допуском 0,5 мм', () => {
  const within = checkRules(
    parsed([record(1, props())], { left: 29.6, right: 15.4, top: 19.6, bottom: 20.4 }),
    testProfile(),
  );
  assert.equal(within.violations.length, 0);

  const outside = checkRules(
    parsed([record(1, props())], { left: 29.4, right: 14.4, top: 20.6, bottom: 19.4 }),
    testProfile(),
  );
  assert.deepEqual(
    outside.violations.map((item) => item.ruleId),
    ['margin.left', 'margin.right', 'margin.top', 'margin.bottom'],
  );
  assert.equal(outside.violations[0].paragraphIndex, 0);
  assert.equal(outside.violations[0].preview, 'Параметры страницы');
  assert.equal(outside.violations[0].actual, '29,4 мм');
  assert.equal(outside.violations[0].expected, '30 мм');
  assert.match(outside.violations[0].hint, /Макет/);
});

test('отсутствующие поля страницы считаются непроверенными, а не ошибкой', () => {
  const report = checkRules(
    parsed([record(1, props())], { left: null, right: 15, top: null, bottom: 20 }),
    testProfile(),
  );
  assert.equal(report.violations.length, 0);
  assert.equal(report.uncheckedCount, 2);
});

test('шрифт сравнивается без учёта регистра и лишних пробелов', () => {
  const ok = checkRules(parsed([record(1, props({ fontFamily: '  times new roman ' }))]), testProfile());
  assert.equal(ok.violations.length, 0);

  const bad = checkRules(parsed([record(1, props({ fontFamily: 'Calibri' }))]), testProfile());
  assert.equal(bad.violations.length, 1);
  assert.equal(bad.violations[0].ruleId, 'font.family');
  assert.equal(bad.violations[0].actual, 'Calibri');
  assert.equal(bad.violations[0].expected, 'Times New Roman');
  assert.equal(bad.violations[0].paragraphIndex, 1);
  assert.equal(bad.violations[0].preview, 'Абзац 1');
});

test('кегль проверяется как минимум с допуском 0,5 пт', () => {
  const ok = checkRules(parsed([record(1, props({ fontSizePt: 13.6 }))]), testProfile());
  assert.equal(ok.violations.length, 0);

  const exact = checkRules(parsed([record(1, props({ fontSizePt: 14 }))]), testProfile());
  assert.equal(exact.violations.length, 0);

  const bad = checkRules(parsed([record(1, props({ fontSizePt: 13.4 }))]), testProfile());
  assert.equal(bad.violations.length, 1);
  assert.equal(bad.violations[0].ruleId, 'font.size');
  assert.equal(bad.violations[0].actual, '13,4 пт');
  assert.equal(bad.violations[0].expected, 'не менее 14 пт');
});

test('междустрочный интервал проверяется с допуском 0,05', () => {
  assert.equal(TOLERANCES.spacing, 0.05);
  assert.equal(checkRules(parsed([record(1, props({ lineSpacing: 1.54 }))]), testProfile()).violations.length, 0);
  const bad = checkRules(parsed([record(1, props({ lineSpacing: 1.56 }))]), testProfile());
  assert.equal(bad.violations[0].ruleId, 'spacing.line');
  assert.equal(bad.violations[0].actual, '1,56');
  assert.equal(bad.violations[0].expected, '1,5');
});

test('абзацный отступ проверяется с допуском 0,5 мм и показывает выступ', () => {
  assert.equal(checkRules(parsed([record(1, props({ firstLine: 12.1 }))]), testProfile()).violations.length, 0);

  const bad = checkRules(parsed([record(1, props({ firstLine: 11.9 }))]), testProfile());
  assert.equal(bad.violations[0].ruleId, 'indent.firstLine');
  assert.equal(bad.violations[0].actual, '11,9 мм');

  const hanging = checkRules(parsed([record(1, props({ firstLine: -12.5 }))]), testProfile());
  assert.equal(hanging.violations[0].actual, '12,5 мм (выступ)');
});

test('выравнивание сравнивается точно и переводится на русский', () => {
  const bad = checkRules(parsed([record(1, props({ alignment: 'center' }))]), testProfile());
  assert.equal(bad.violations.length, 1);
  assert.equal(bad.violations[0].ruleId, 'alignment');
  assert.equal(bad.violations[0].actual, 'по центру');
  assert.equal(bad.violations[0].expected, 'по ширине');
});

test('неизвестные значения пропускают правило и увеличивают счётчик непроверенного', () => {
  const report = checkRules(
    parsed([record(1, props({
      fontKnown: false,
      sizeKnown: false,
      lineKnown: false,
      indentKnown: false,
      alignmentKnown: false,
    }))]),
    testProfile(),
  );
  assert.equal(report.violations.length, 0);
  assert.equal(report.uncheckedCount, 5);
  assert.equal(report.totalChecked, 1);
});

test('несколько runs: достаточно одного неверного шрифта или мелкого кегля', () => {
  const properties = props();
  properties.runs = [
    { text: 'A', fontFamily: 'Times New Roman', fontKnown: true, fontSizePt: 14, sizeKnown: true },
    { text: 'B', fontFamily: 'Calibri', fontKnown: true, fontSizePt: 12, sizeKnown: true },
  ];
  const report = checkRules(parsed([record(1, properties)]), testProfile());
  assert.deepEqual(
    report.violations.map((item) => item.ruleId),
    ['font.family', 'font.size'],
  );
  assert.equal(report.violations[0].actual, 'Calibri');
  assert.equal(report.violations[1].actual, '12 пт');
});

test('пропущенные абзацы не считаются проверенными', () => {
  const report = checkRules(
    parsed([
      record(1, props(), 'title'),
      record(2, props()),
      record(3, props(), 'table'),
    ]),
    testProfile(),
  );
  assert.equal(report.totalChecked, 1);
  assert.equal(report.skippedCount, 2);
});

test('нарушения сортируются по месту, поля — первыми, countsByRule заполняется', () => {
  const report = checkRules(
    parsed([
      record(2, props({ fontFamily: 'Arial' })),
      record(1, props({ alignment: 'left' })),
    ], { left: 20, right: 15, top: 20, bottom: 20 }),
    testProfile(),
  );
  assert.deepEqual(
    report.violations.map((item) => `${item.paragraphIndex}:${item.ruleId}`),
    ['0:margin.left', '1:alignment', '2:font.family'],
  );
  assert.deepEqual(report.countsByRule, {
    'margin.left': 1,
    alignment: 1,
    'font.family': 1,
  });
});

test('подсказки подставляют числа и шрифт из профиля', () => {
  const profile = testProfile({
    marginsMm: { left: 25, right: 10, top: 15, bottom: 15 },
    fontFamily: 'Times New Roman',
    minFontPt: 16,
    lineSpacing: 2,
    firstLineMm: 15,
    alignment: 'center',
  });
  const report = checkRules(
    parsed(
      [record(1, props({ fontFamily: 'Calibri', fontSizePt: 14, lineSpacing: 1, firstLine: 0, alignment: 'left' }))],
      { left: 30, right: 10, top: 15, bottom: 15 },
    ),
    profile,
  );

  const hints = Object.fromEntries(report.violations.map((item) => [item.ruleId, item.hint]));
  assert.match(hints['margin.left'], /25 мм/);
  assert.match(hints['font.family'], /Times New Roman/);
  assert.match(hints['font.size'], /16 пт/);
  assert.match(hints['spacing.line'], /→ 2$/);
  assert.match(hints['indent.firstLine'], /1,5 см/);
  assert.match(hints.alignment, /По центру/);
});
