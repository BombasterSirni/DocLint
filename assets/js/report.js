/**
 * Представление отчёта: категории, объединение соседних одинаковых
 * нарушений, сводка и русские числительные.
 */

export const CATEGORY_DEFS = Object.freeze([
  { id: 'margins', label: 'Поля страницы' },
  { id: 'font', label: 'Шрифт' },
  { id: 'size', label: 'Размер шрифта' },
  { id: 'spacing', label: 'Интервал' },
  { id: 'indent', label: 'Отступ' },
  { id: 'alignment', label: 'Выравнивание' },
]);

const CATEGORY_BY_RULE = Object.freeze({
  'margin.left': 'margins',
  'margin.right': 'margins',
  'margin.top': 'margins',
  'margin.bottom': 'margins',
  'font.family': 'font',
  'font.size': 'size',
  'spacing.line': 'spacing',
  'indent.firstLine': 'indent',
  alignment: 'alignment',
});

const CATEGORY_LABELS = new Map(CATEGORY_DEFS.map((category) => [category.id, category.label]));
const CATEGORY_ORDER = new Map(CATEGORY_DEFS.map((category, index) => [category.id, index]));

export function categoryFor(ruleId) {
  return CATEGORY_BY_RULE[ruleId] || 'other';
}

export function categoryLabel(categoryId) {
  return CATEGORY_LABELS.get(categoryId) || 'Прочее';
}

/** Склонение: pluralize(5, ['нарушение','нарушения','нарушений']) → 'нарушений'. */
export function pluralize(count, forms) {
  const absolute = Math.abs(count) % 100;
  const last = absolute % 10;
  if (absolute > 10 && absolute < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

const VIOLATION_FORMS = Object.freeze(['нарушение', 'нарушения', 'нарушений']);
const CATEGORY_FORMS = Object.freeze(['категории', 'категориях', 'категориях']);

/**
 * Объединяет нарушения с одинаковым ruleId и actual в соседних абзацах.
 * Нарушения полей страницы остаются отдельными карточками.
 * @param {Array} violations
 */
export function groupViolations(violations) {
  const groups = [];
  const openByKey = new Map();

  for (const item of violations) {
    const category = categoryFor(item.ruleId);
    const isPageLevel = category === 'margins';

    if (!isPageLevel) {
      const key = `${item.ruleId}\u0000${item.actual}`;
      const open = openByKey.get(key);
      if (open && item.paragraphIndex === open.toIndex + 1) {
        open.toIndex = item.paragraphIndex;
        open.count += 1;
        continue;
      }
    }

    const group = {
      ruleId: item.ruleId,
      category,
      categoryLabel: categoryLabel(category),
      fromIndex: item.paragraphIndex,
      toIndex: item.paragraphIndex,
      count: 1,
      preview: item.preview,
      actual: item.actual,
      expected: item.expected,
      hint: item.hint,
      isPageLevel,
    };
    groups.push(group);
    if (!isPageLevel) {
      openByKey.set(`${item.ruleId}\u0000${item.actual}`, group);
    }
  }

  return groups;
}

/** Счётчики по категориям в фиксированном порядке. */
export function countByCategory(violations) {
  const counts = new Map();
  for (const item of violations) {
    const category = categoryFor(item.ruleId);
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  return CATEGORY_DEFS
    .filter((category) => (counts.get(category.id) || 0) > 0)
    .map((category) => ({
      id: category.id,
      label: category.label,
      count: counts.get(category.id) || 0,
    }));
}

/** Готовая модель для интерфейса: группы, фильтры и текст сводки. */
export function buildReportView(report) {
  const groups = groupViolations(report.violations);
  const categories = countByCategory(report.violations);
  const total = report.violations.length;
  let summary;
  if (total === 0) {
    summary = 'Нарушений не найдено в проверяемых правилах.';
  } else {
    const categoryWord = pluralize(categories.length, CATEGORY_FORMS);
    summary = `${total} ${pluralize(total, VIOLATION_FORMS)} в ${categories.length} ${categoryWord}`;
  }
  return {
    groups,
    categories,
    total,
    summary,
    checkedLabel: `Проверено абзацев: ${report.totalChecked}`,
    skippedLabel: report.skippedCount > 0
      ? `Пропущено абзацев: ${report.skippedCount}`
      : '',
    uncheckedLabel: report.uncheckedCount > 0
      ? `Проверок недоступно: ${report.uncheckedCount}`
      : '',
  };
}

/** Порядок категорий для фильтра. */
export function sortCategories(categories) {
  return [...categories].sort(
    (left, right) => (CATEGORY_ORDER.get(left.id) ?? 99) - (CATEGORY_ORDER.get(right.id) ?? 99),
  );
}
