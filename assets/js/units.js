/**
 * Перевод единиц Word (OOXML) в человеческие.
 * twips: 1/20 пункта, 1 дюйм = 1440 twips.
 * half-points: размер шрифта в document.xml хранится в половинах пункта.
 * line (lineRule="auto"): 240 = одинарный интервал.
 */

export const TWIPS_PER_INCH = 1440;
export const MM_PER_INCH = 25.4;
export const EMU_PER_MM = 36000;

/** twips → миллиметры. */
export function twipsToMm(twips) {
  return (Number(twips) * MM_PER_INCH) / TWIPS_PER_INCH;
}

/** миллиметры → twips (для тестов и демонстрационного документа). */
export function mmToTwips(mm) {
  return Math.round((Number(mm) * TWIPS_PER_INCH) / MM_PER_INCH);
}

/** половины пункта → пункты. */
export function halfPointsToPt(halfPoints) {
  return Number(halfPoints) / 2;
}

/** пункты → половины пункта (для тестов). */
export function ptToHalfPoints(pt) {
  return Math.round(Number(pt) * 2);
}

/** значение w:spacing/@w:line при lineRule="auto" → кратность интервала. */
export function lineTwipsToMultiple(line) {
  return Number(line) / 240;
}

/** кратность интервала → значение w:spacing/@w:line. */
export function multipleToLineTwips(multiple) {
  return Math.round(Number(multiple) * 240);
}

/** Число с фиксированной точностью без хвостовых нулей. */
export function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
