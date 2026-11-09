/**
 * Профили оформления: валидация, хранение в localStorage, импорт/экспорт.
 * Чистые функции не обращаются к DOM до вызова; хранилище можно подменить
 * адаптером с getItem/setItem (используется в тестах).
 */

import { DocLintError, ERROR_CODES } from './errors.js';
import { BUILTIN_PROFILES, isBuiltinProfileId } from './presets.js';

export const PROFILE_SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'doclint.profiles';
export const ALIGNMENTS = Object.freeze(['left', 'center', 'right', 'justify']);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const NAME_MAX_LENGTH = 80;
const FONT_FAMILY_MAX_LENGTH = 64;
const MARGIN_SIDES = Object.freeze(['left', 'right', 'top', 'bottom']);

const ALIGNMENT_LABELS = Object.freeze({
  left: 'по левому краю',
  center: 'по центру',
  right: 'по правому краю',
  justify: 'по ширине',
});

const TRANSLITERATION = Object.freeze({
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
});

/** Ошибка профиля с перечнем проблемных полей. */
function invalidProfile(message, fields) {
  return new DocLintError(ERROR_CODES.INVALID_PROFILE, message, fields);
}

/** Только обычные объекты (литералы и Object.create(null)). */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Глубокая копия профиля строго по схеме. */
function cloneProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    version: profile.version,
    marginsMm: {
      left: profile.marginsMm.left,
      right: profile.marginsMm.right,
      top: profile.marginsMm.top,
      bottom: profile.marginsMm.bottom,
    },
    fontFamily: profile.fontFamily,
    minFontPt: profile.minFontPt,
    lineSpacing: profile.lineSpacing,
    firstLineMm: profile.firstLineMm,
    alignment: profile.alignment,
  };
}

/**
 * Проверяет и нормализует профиль.
 * @param {unknown} input
 * @returns {object} копия только с полями схемы
 * @throws {DocLintError} INVALID_PROFILE со списком неверных полей в details
 */
export function validateProfile(input) {
  if (!isPlainObject(input)) {
    throw invalidProfile(
      'Профиль оформления должен быть объектом.',
      ['profile'],
    );
  }

  const errors = [];

  if (input.version !== PROFILE_SCHEMA_VERSION) errors.push('version');

  const id = input.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) errors.push('id');

  let name = '';
  if (typeof input.name === 'string') {
    name = input.name.trim();
    if (name.length === 0 || name.length > NAME_MAX_LENGTH) errors.push('name');
  } else {
    errors.push('name');
  }

  const margins = input.marginsMm;
  if (!isPlainObject(margins)) {
    errors.push('marginsMm');
  } else {
    for (const side of MARGIN_SIDES) {
      if (!isFiniteNumber(margins[side]) || margins[side] <= 0) {
        errors.push(`marginsMm.${side}`);
      }
    }
  }

  let fontFamily = '';
  if (typeof input.fontFamily === 'string') {
    fontFamily = input.fontFamily.trim();
    if (fontFamily.length === 0 || fontFamily.length > FONT_FAMILY_MAX_LENGTH) {
      errors.push('fontFamily');
    }
  } else {
    errors.push('fontFamily');
  }

  if (!isFiniteNumber(input.minFontPt) || input.minFontPt <= 0) {
    errors.push('minFontPt');
  }
  if (!isFiniteNumber(input.lineSpacing) || input.lineSpacing <= 0) {
    errors.push('lineSpacing');
  }
  if (!isFiniteNumber(input.firstLineMm) || input.firstLineMm < 0) {
    errors.push('firstLineMm');
  }
  if (!ALIGNMENTS.includes(input.alignment)) errors.push('alignment');

  if (errors.length > 0) {
    throw invalidProfile(
      `Некорректный профиль оформления: проверьте поля ${errors.join(', ')}.`,
      errors,
    );
  }

  return {
    id,
    name,
    version: PROFILE_SCHEMA_VERSION,
    marginsMm: {
      left: margins.left,
      right: margins.right,
      top: margins.top,
      bottom: margins.bottom,
    },
    fontFamily,
    minFontPt: input.minFontPt,
    lineSpacing: input.lineSpacing,
    firstLineMm: input.firstLineMm,
    alignment: input.alignment,
  };
}

/** Является ли идентификатор встроенным. */
export function isBuiltinProfile(id) {
  return isBuiltinProfileId(id);
}

function resolveStorage(storage) {
  if (storage !== undefined && storage !== null) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Пользовательские профили из хранилища; повреждённые данные — пустой список. */
function readStoredProfiles(storage) {
  const target = resolveStorage(storage);
  if (!target || typeof target.getItem !== 'function') return [];

  let raw;
  try {
    raw = target.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (typeof raw !== 'string' || raw.trim() === '') return [];

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return [];
  }
  if (
    !isPlainObject(envelope) ||
    envelope.version !== PROFILE_SCHEMA_VERSION ||
    !Array.isArray(envelope.profiles)
  ) {
    return [];
  }

  const profiles = [];
  const seenIds = new Set();
  for (const item of envelope.profiles) {
    try {
      const profile = validateProfile(item);
      if (isBuiltinProfileId(profile.id) || seenIds.has(profile.id)) continue;
      seenIds.add(profile.id);
      profiles.push(profile);
    } catch {
      // Один повреждённый профиль не должен скрывать остальные.
    }
  }
  return profiles;
}

function persistProfiles(storage, profiles) {
  const target = resolveStorage(storage);
  if (!target || typeof target.setItem !== 'function') {
    throw new Error('Локальное хранилище недоступно.');
  }
  target.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: PROFILE_SCHEMA_VERSION, profiles }),
  );
}

/** Встроенные профили, затем сохранённые пользовательские (глубокие копии). */
export function listProfiles(storage) {
  const builtins = BUILTIN_PROFILES.map((profile) => cloneProfile(profile));
  return builtins.concat(readStoredProfiles(storage));
}

/** Профиль по идентификатору или null. */
export function getProfile(id, storage) {
  const builtin = BUILTIN_PROFILES.find((profile) => profile.id === id);
  if (builtin) return cloneProfile(builtin);
  const stored = readStoredProfiles(storage).find((profile) => profile.id === id);
  return stored ? cloneProfile(stored) : null;
}

/**
 * Сохраняет пользовательский профиль (валидирует и возвращает копию).
 * @throws {DocLintError} INVALID_PROFILE для неверных данных и встроенных id
 */
export function saveProfile(profile, storage) {
  const normalized = validateProfile(profile);
  if (isBuiltinProfileId(normalized.id)) {
    throw invalidProfile(
      'Встроенный профиль нельзя перезаписать. Сохраните его под другим именем.',
      ['id'],
    );
  }

  const profiles = readStoredProfiles(storage);
  const index = profiles.findIndex((item) => item.id === normalized.id);
  if (index >= 0) profiles[index] = normalized;
  else profiles.push(normalized);

  persistProfiles(storage, profiles);
  return cloneProfile(normalized);
}

/** Красивый JSON профиля для скачивания. */
export function exportProfile(id, storage) {
  const profile = getProfile(id, storage);
  if (!profile) {
    throw invalidProfile('Профиль не найден.', ['id']);
  }
  return JSON.stringify(profile, null, 2);
}

/** Транслитерация названия в допустимый ASCII-идентификатор. */
function slugifyProfileName(name) {
  const latin = String(name)
    .toLowerCase()
    .split('')
    .map((character) => TRANSLITERATION[character] ?? character)
    .join('');
  const slug = latin
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'profile';
}

/** Уникальный id вида `<транслит>-copy` / `<транслит>-copy-2`. */
function buildCopyId(name, takenIds) {
  const base = slugifyProfileName(name);
  let attempt = 1;
  let candidate;
  do {
    const suffix = attempt === 1 ? '-copy' : `-copy-${attempt}`;
    const maxStemLength = 64 - suffix.length;
    const stem = (
      base.length > maxStemLength ? base.slice(0, maxStemLength) : base
    ).replace(/-+$/g, '');
    candidate = `${stem || 'profile'}${suffix}`;
    attempt += 1;
  } while (takenIds.has(candidate));
  return candidate;
}

/**
 * Импорт профиля из строки JSON или File/Blob-подобного объекта с .text().
 * @param {string|{text: () => string|Promise<string>}} fileOrText
 * @throws {DocLintError} INVALID_PROFILE
 */
export async function importProfile(fileOrText, storage) {
  let text;
  if (typeof fileOrText === 'string') {
    text = fileOrText;
  } else if (fileOrText && typeof fileOrText.text === 'function') {
    text = await fileOrText.text();
  } else {
    throw invalidProfile(
      'Не удалось прочитать файл профиля.',
      ['file'],
    );
  }
  if (typeof text !== 'string') {
    throw invalidProfile('Не удалось прочитать файл профиля.', ['file']);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalidProfile(
      'Файл профиля повреждён: некорректный JSON.',
      ['file'],
    );
  }

  let profile = validateProfile(parsed);
  const profiles = readStoredProfiles(storage);

  if (isBuiltinProfileId(profile.id)) {
    const takenIds = new Set(BUILTIN_PROFILES.map((item) => item.id));
    for (const item of profiles) takenIds.add(item.id);
    profile = validateProfile({
      ...profile,
      id: buildCopyId(profile.name, takenIds),
    });
    profiles.push(profile);
  } else {
    const index = profiles.findIndex((item) => item.id === profile.id);
    if (index >= 0) profiles[index] = profile;
    else profiles.push(profile);
  }

  persistProfiles(storage, profiles);
  return cloneProfile(profile);
}

/** Число с русской десятичной запятой и без хвостовых нулей. */
function formatRuNumber(value) {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  return String(rounded).replace('.', ',');
}

/**
 * Компактное описание профиля одной строкой.
 * @returns {string} например «Поля 30/15/20/20 мм · Times New Roman, ≥12 пт · …»
 */
export function formatProfileSummary(profile) {
  const margins = profile.marginsMm;
  const alignment = ALIGNMENT_LABELS[profile.alignment] ?? String(profile.alignment);
  return [
    `Поля ${formatRuNumber(margins.left)}/${formatRuNumber(margins.right)}/${formatRuNumber(margins.top)}/${formatRuNumber(margins.bottom)} мм`,
    `${profile.fontFamily}, ≥${formatRuNumber(profile.minFontPt)} пт`,
    `интервал ${formatRuNumber(profile.lineSpacing)}`,
    `отступ ${formatRuNumber(profile.firstLineMm)} мм`,
    alignment,
  ].join(' · ');
}
