import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  categoryFor,
  groupViolations,
  buildReportView,
  pluralize,
  countByCategory,
  sortCategories,
} from '../assets/js/report.js';

function violation(paragraphIndex, ruleId, actual = 'x', extra = {}) {
  return {
    paragraphIndex,
    preview: `Абзац ${paragraphIndex}`,
    ruleId,
    actual,
    expected: 'требуется',
    hint: 'подсказка',
    ...extra,
  };
}

function report(violations, overrides = {}) {
  return {
    totalChecked: 10,
    skippedCount: 2,
    uncheckedCount: 0,
    countsByRule: {},
    violations,
    ...overrides,
  };
}

test('pluralize выбирает русскую форму', () => {
  const forms = ['нарушение', 'нарушения', 'нарушений'];
  assert.equal(pluralize(1, forms), 'нарушение');
  assert.equal(pluralize(2, forms), 'нарушения');
  assert.equal(pluralize(5, forms), 'нарушений');
  assert.equal(pluralize(11, forms), 'нарушений');
  assert.equal(pluralize(21, forms), 'нарушение');
  assert.equal(pluralize(22, forms), 'нарушения');
  assert.equal(pluralize(0, forms), 'нарушений');
});

test('соседние абзацы с одинаковым правилом и значением объединяются, даже если правила чередуются', () => {
  const groups = groupViolations([
    violation(1, 'font.family', 'Calibri'),
    violation(1, 'spacing.line', '1'),
    violation(2, 'font.family', 'Calibri'),
    violation(2, 'spacing.line', '1'),
    violation(3, 'font.family', 'Calibri'),
  ]);

  const font = groups.find((group) => group.ruleId === 'font.family');
  assert.equal(font.fromIndex, 1);
  assert.equal(font.toIndex, 3);
  assert.equal(font.count, 3);

  const spacing = groups.find((group) => group.ruleId === 'spacing.line');
  assert.equal(spacing.fromIndex, 1);
  assert.equal(spacing.toIndex, 2);
  assert.equal(spacing.count, 2);
});

test('разрыв в нумерации или другое actual не объединяются', () => {
  const groups = groupViolations([
    violation(1, 'font.family', 'Calibri'),
    violation(3, 'font.family', 'Calibri'),
    violation(4, 'font.family', 'Arial'),
    violation(5, 'font.family', 'Arial'),
  ]);
  assert.deepEqual(
    groups.map((group) => [group.fromIndex, group.toIndex, group.count]),
    [[1, 1, 1], [3, 3, 1], [4, 5, 2]],
  );
});

test('нарушения полей страницы остаются отдельными карточками без диапазона абзацев', () => {
  const groups = groupViolations([
    violation(0, 'margin.left', '20 мм'),
    violation(0, 'margin.right', '10 мм'),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].isPageLevel, true);
  assert.equal(groups[0].fromIndex, 0);
  assert.equal(groups[0].toIndex, 0);
  assert.equal(groups[1].isPageLevel, true);
});

test('категории и сводка считаются по нарушениям', () => {
  const view = buildReportView(report([
    violation(0, 'margin.left', '20 мм'),
    violation(1, 'font.family', 'Calibri'),
    violation(2, 'font.family', 'Calibri'),
    violation(2, 'font.size', '11 пт'),
    violation(3, 'alignment', 'по левому краю'),
  ]));

  assert.equal(view.total, 5);
  assert.equal(view.summary, '5 нарушений в 4 категориях');
  assert.deepEqual(
    view.categories.map((category) => [category.id, category.count]),
    [['margins', 1], ['font', 2], ['size', 1], ['alignment', 1]],
  );
  assert.equal(view.checkedLabel, 'Проверено абзацев: 10');
  assert.equal(view.skippedLabel, 'Пропущено абзацев: 2');
  assert.equal(view.uncheckedLabel, '');
});

test('пустой отчёт сообщает об отсутствии нарушений в проверяемых правилах', () => {
  const view = buildReportView(report([]));
  assert.equal(view.total, 0);
  assert.equal(view.groups.length, 0);
  assert.match(view.summary, /Нарушений не найдено/);
});

test('countByCategory и sortCategories сохраняют фиксированный порядок категорий', () => {
  const categories = countByCategory([
    violation(3, 'alignment'),
    violation(1, 'font.size'),
    violation(0, 'margin.top'),
  ]);
  assert.deepEqual(
    sortCategories(categories).map((category) => category.id),
    ['margins', 'size', 'alignment'],
  );
});

test('categoryFor неизвестного правила не падает', () => {
  assert.equal(categoryFor('unknown.rule'), 'other');
  assert.equal(categoryFor('margin.bottom'), 'margins');
});
