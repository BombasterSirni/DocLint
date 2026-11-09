/**
 * Правила проверки оформления и сборка Report.
 * Допуски зафиксированы в ТЗ: ±0,5 мм, ±0,5 пт, ±0,05 интервала.
 * Неизвестное значение не считается ошибкой — проверка пропускается.
 */

import { hintFor } from './hints.js';
import { roundTo } from './units.js';

export const TOLERANCES = Object.freeze({
  mm: 0.5,
  pt: 0.5,
  spacing: 0.05,
});

const ALIGNMENT_LABELS = Object.freeze({
  left: 'по левому краю',
  center: 'по центру',
  right: 'по правому краю',
  justify: 'по ширине',
});

const MARGIN_RULES = Object.freeze([
  { id: 'margin.left', side: 'left' },
  { id: 'margin.right', side: 'right' },
  { id: 'margin.top', side: 'top' },
  { id: 'margin.bottom', side: 'bottom' },
]);

const PARAGRAPH_RULE_ORDER = Object.freeze([
  'font.family',
  'font.size',
  'spacing.line',
  'indent.firstLine',
  'alignment',
]);

function formatNumber(value, digits = 2) {
  return String(roundTo(value, digits)).replace('.', ',');
}

function formatMm(value) {
  return `${formatNumber(value, 1)} мм`;
}

function formatPt(value) {
  return `${formatNumber(value, 1)} пт`;
}

function formatSpacing(value) {
  return formatNumber(value, 2);
}

function sameText(left, right) {
  return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

function expectedFor(ruleId, profile) {
  switch (ruleId) {
    case 'margin.left':
      return formatMm(profile.marginsMm.left);
    case 'margin.right':
      return formatMm(profile.marginsMm.right);
    case 'margin.top':
      return formatMm(profile.marginsMm.top);
    case 'margin.bottom':
      return formatMm(profile.marginsMm.bottom);
    case 'font.family':
      return profile.fontFamily;
    case 'font.size':
      return `не менее ${formatPt(profile.minFontPt)}`;
    case 'spacing.line':
      return formatSpacing(profile.lineSpacing);
    case 'indent.firstLine':
      return formatMm(profile.firstLineMm);
    case 'alignment':
      return ALIGNMENT_LABELS[profile.alignment] || profile.alignment;
    default:
      return '';
  }
}

function violation({ paragraphIndex, preview, ruleId, actual, expected, profile }) {
  return {
    paragraphIndex,
    preview,
    ruleId,
    actual,
    expected,
    hint: hintFor(ruleId, profile),
  };
}

function checkMargins(pageMargins, profile) {
  const violations = [];
  let unchecked = 0;
  for (const { id, side } of MARGIN_RULES) {
    const actual = pageMargins ? pageMargins[side] : null;
    if (actual === null || actual === undefined || !Number.isFinite(actual)) {
      unchecked += 1;
      continue;
    }
    const expected = profile.marginsMm[side];
    if (Math.abs(actual - expected) > TOLERANCES.mm + Number.EPSILON) {
      violations.push(violation({
        paragraphIndex: 0,
        preview: 'Параметры страницы',
        ruleId: id,
        actual: formatMm(actual),
        expected: expectedFor(id, profile),
        profile,
      }));
    }
  }
  return { violations, unchecked };
}

function checkParagraph(record, profile) {
  const violations = [];
  let unchecked = 0;
  const properties = record.properties;
  const paragraph = properties.paragraph;

  // Шрифт: проверяем каждый непустой фрагмент; в отчёт попадает первое отличие.
  const fontValues = properties.runs.filter((run) => run.fontKnown);
  if (fontValues.length === 0) {
    unchecked += 1;
  } else {
    const offending = fontValues.find((run) => !sameText(run.fontFamily, profile.fontFamily));
    if (offending) {
      violations.push(violation({
        paragraphIndex: record.index,
        preview: record.preview,
        ruleId: 'font.family',
        actual: offending.fontFamily,
        expected: expectedFor('font.family', profile),
        profile,
      }));
    }
  }

  const sizeValues = properties.runs.filter((run) => run.sizeKnown && Number.isFinite(run.fontSizePt));
  if (sizeValues.length === 0) {
    unchecked += 1;
  } else {
    const offending = sizeValues.find(
      (run) => run.fontSizePt < profile.minFontPt - TOLERANCES.pt - Number.EPSILON,
    );
    if (offending) {
      violations.push(violation({
        paragraphIndex: record.index,
        preview: record.preview,
        ruleId: 'font.size',
        actual: formatPt(offending.fontSizePt),
        expected: expectedFor('font.size', profile),
        profile,
      }));
    }
  }

  if (paragraph.lineSpacing.known) {
    const actual = paragraph.lineSpacing.value;
    if (Math.abs(actual - profile.lineSpacing) > TOLERANCES.spacing + Number.EPSILON) {
      violations.push(violation({
        paragraphIndex: record.index,
        preview: record.preview,
        ruleId: 'spacing.line',
        actual: formatSpacing(actual),
        expected: expectedFor('spacing.line', profile),
        profile,
      }));
    }
  } else {
    unchecked += 1;
  }

  if (paragraph.firstLine.known) {
    const actual = paragraph.firstLine.value;
    if (Math.abs(actual - profile.firstLineMm) > TOLERANCES.mm + Number.EPSILON) {
      const formatted = actual < 0
        ? `${formatMm(Math.abs(actual))} (выступ)`
        : formatMm(actual);
      violations.push(violation({
        paragraphIndex: record.index,
        preview: record.preview,
        ruleId: 'indent.firstLine',
        actual: formatted,
        expected: expectedFor('indent.firstLine', profile),
        profile,
      }));
    }
  } else {
    unchecked += 1;
  }

  if (paragraph.alignment.known) {
    if (paragraph.alignment.value !== profile.alignment) {
      violations.push(violation({
        paragraphIndex: record.index,
        preview: record.preview,
        ruleId: 'alignment',
        actual: ALIGNMENT_LABELS[paragraph.alignment.value] || paragraph.alignment.value,
        expected: expectedFor('alignment', profile),
        profile,
      }));
    }
  } else {
    unchecked += 1;
  }

  return { violations, unchecked };
}

const RULE_ORDER_INDEX = new Map(
  [
    ...MARGIN_RULES.map((rule) => rule.id),
    ...PARAGRAPH_RULE_ORDER,
  ].map((id, index) => [id, index]),
);

function compareViolations(left, right) {
  if (left.paragraphIndex !== right.paragraphIndex) {
    return left.paragraphIndex - right.paragraphIndex;
  }
  return (RULE_ORDER_INDEX.get(left.ruleId) ?? 99) - (RULE_ORDER_INDEX.get(right.ruleId) ?? 99);
}

/**
 * @param {{paragraphs: Array, pageMargins: object}} parsed
 * @param {object} profile валидный профиль
 * @returns {{totalChecked:number, skippedCount:number, uncheckedCount:number,
 *   countsByRule: Record<string, number>, violations: Array}}
 */
export function checkRules(parsed, profile) {
  const marginResult = checkMargins(parsed.pageMargins, profile);
  const violations = [...marginResult.violations];
  let uncheckedCount = marginResult.unchecked;
  let totalChecked = 0;
  let skippedCount = 0;

  for (const record of parsed.paragraphs) {
    if (record.skippedReason || !record.properties) {
      skippedCount += 1;
      continue;
    }
    totalChecked += 1;
    const result = checkParagraph(record, profile);
    violations.push(...result.violations);
    uncheckedCount += result.unchecked;
  }

  violations.sort(compareViolations);

  const countsByRule = {};
  for (const item of violations) {
    countsByRule[item.ruleId] = (countsByRule[item.ruleId] || 0) + 1;
  }

  return {
    totalChecked,
    skippedCount,
    uncheckedCount,
    countsByRule,
    violations,
  };
}
