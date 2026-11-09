/**
 * Встроенные профили оформления DocLint.
 * Значения зафиксированы по ГОСТ 7.32-2017 и типовой методичке.
 * Массив и все вложенные объекты глубоко заморожены: изменения не допускаются.
 */

/** Рекурсивно замораживает объект/массив. */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

export const BUILTIN_PROFILES = deepFreeze([
  {
    id: 'gost-7.32-2017',
    name: 'ГОСТ 7.32-2017',
    version: 1,
    marginsMm: { left: 30, right: 15, top: 20, bottom: 20 },
    fontFamily: 'Times New Roman',
    minFontPt: 12,
    lineSpacing: 1.5,
    firstLineMm: 12.5,
    alignment: 'justify',
  },
  {
    id: 'method-14',
    name: 'Типовая методичка (кегль 14)',
    version: 1,
    marginsMm: { left: 30, right: 15, top: 20, bottom: 20 },
    fontFamily: 'Times New Roman',
    minFontPt: 14,
    lineSpacing: 1.5,
    firstLineMm: 12.5,
    alignment: 'justify',
  },
]);

/** Является ли идентификатор идентификатором встроенного профиля. */
export function isBuiltinProfileId(id) {
  return BUILTIN_PROFILES.some((profile) => profile.id === id);
}
