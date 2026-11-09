/**
 * Подсказки к замечаниям: короткие названия категорий и пути в меню Word.
 */

export const RULE_LABELS = Object.freeze({
  'margin.left': 'Левое поле',
  'margin.right': 'Правое поле',
  'margin.top': 'Верхнее поле',
  'margin.bottom': 'Нижнее поле',
  'font.family': 'Шрифт',
  'font.size': 'Размер шрифта',
  'spacing.line': 'Междустрочный интервал',
  'indent.firstLine': 'Абзацный отступ',
  alignment: 'Выравнивание',
});

export const RULE_HINTS = Object.freeze({
  'margin.left': 'Макет → Поля → Настроить поля → Левое: 30 мм',
  'margin.right': 'Макет → Поля → Настроить поля → Правое: 15 мм',
  'margin.top': 'Макет → Поля → Настроить поля → Верхнее: 20 мм',
  'margin.bottom': 'Макет → Поля → Настроить поля → Нижнее: 20 мм',
  'font.family': 'Главная → Шрифт → Times New Roman',
  'font.size': 'Главная → Размер шрифта → 14 пт',
  'spacing.line': 'Главная → Абзац → Междустрочный → 1,5',
  'indent.firstLine': 'Главная → Абзац → Первая строка → Отступ 1,25 см',
  alignment: 'Главная → Абзац → Выравнивание → По ширине',
});

const GENERIC_HINT =
  'Проверьте параметр оформления в Word: «Главная → Абзац» или «Макет → Поля».';

const ALIGNMENT_HINTS = Object.freeze({
  left: 'левому краю',
  center: 'центру',
  right: 'правому краю',
  justify: 'ширине',
});

function formatNumber(value, digits = 2) {
  const factor = 10 ** digits;
  const rounded = Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  return String(rounded).replace('.', ',');
}

function formatMm(value) {
  return `${formatNumber(value, 1)} мм`;
}

function formatCm(value) {
  return `${formatNumber(Number(value) / 10, 2)} см`;
}

/** Подсказка с конкретными числами профиля; без профиля — статичный текст. */
export function hintFor(ruleId, profile = null) {
  if (profile && profile.marginsMm) {
    switch (ruleId) {
      case 'margin.left':
        return `Макет → Поля → Настроить поля → Левое: ${formatMm(profile.marginsMm.left)}`;
      case 'margin.right':
        return `Макет → Поля → Настроить поля → Правое: ${formatMm(profile.marginsMm.right)}`;
      case 'margin.top':
        return `Макет → Поля → Настроить поля → Верхнее: ${formatMm(profile.marginsMm.top)}`;
      case 'margin.bottom':
        return `Макет → Поля → Настроить поля → Нижнее: ${formatMm(profile.marginsMm.bottom)}`;
      case 'font.family':
        return `Главная → Шрифт → ${profile.fontFamily}`;
      case 'font.size':
        return `Главная → Размер шрифта → ${formatNumber(profile.minFontPt, 1)} пт`;
      case 'spacing.line':
        return `Главная → Абзац → Междустрочный → ${formatNumber(profile.lineSpacing, 2)}`;
      case 'indent.firstLine':
        return `Главная → Абзац → Первая строка → Отступ ${formatCm(profile.firstLineMm)}`;
      case 'alignment':
        return `Главная → Абзац → Выравнивание → По ${
          ALIGNMENT_HINTS[profile.alignment] || profile.alignment
        }`;
      default:
        break;
    }
  }
  return Object.hasOwn(RULE_HINTS, ruleId) ? RULE_HINTS[ruleId] : GENERIC_HINT;
}
