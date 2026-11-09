import test from 'node:test';
import assert from 'node:assert/strict';

import { DocLintError, ERROR_CODES } from '../assets/js/errors.js';
import { BUILTIN_PROFILES, isBuiltinProfileId } from '../assets/js/presets.js';
import { RULE_LABELS, RULE_HINTS, hintFor } from '../assets/js/hints.js';
import {
  PROFILE_SCHEMA_VERSION,
  STORAGE_KEY,
  ALIGNMENTS,
  validateProfile,
  isBuiltinProfile,
  listProfiles,
  getProfile,
  saveProfile,
  exportProfile,
  importProfile,
  formatProfileSummary,
} from '../assets/js/profiles.js';

const RULE_IDS = [
  'margin.left',
  'margin.right',
  'margin.top',
  'margin.bottom',
  'font.family',
  'font.size',
  'spacing.line',
  'indent.firstLine',
  'alignment',
];

function createMemoryStorage(seed) {
  const data = new Map();
  if (seed !== undefined) data.set(STORAGE_KEY, seed);
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    clear() {
      data.clear();
    },
    raw() {
      return data.get(STORAGE_KEY) ?? null;
    },
  };
}

function makeProfile(overrides = {}) {
  return {
    id: 'my-profile',
    name: 'Мой профиль',
    version: 1,
    marginsMm: { left: 30, right: 15, top: 20, bottom: 20 },
    fontFamily: 'Times New Roman',
    minFontPt: 12,
    lineSpacing: 1.5,
    firstLineMm: 12.5,
    alignment: 'justify',
    ...overrides,
  };
}

function expectInvalidProfile(callback, expectedFields = []) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof DocLintError, 'ожидалась DocLintError');
    assert.equal(error.code, ERROR_CODES.INVALID_PROFILE);
    assert.ok(Array.isArray(error.details), 'details должен быть массивом');
    for (const field of expectedFields) {
      assert.ok(
        error.details.includes(field),
        `в details ожидалось поле ${field}, получено: ${error.details.join(', ')}`,
      );
    }
    return true;
  });
}

test('встроенные профили валидны и глубоко заморожены', () => {
  assert.equal(BUILTIN_PROFILES.length, 2);
  assert.deepEqual(
    BUILTIN_PROFILES.map((profile) => profile.id),
    ['gost-7.32-2017', 'method-14'],
  );
  assert.ok(Object.isFrozen(BUILTIN_PROFILES));
  for (const profile of BUILTIN_PROFILES) {
    assert.ok(Object.isFrozen(profile));
    assert.ok(Object.isFrozen(profile.marginsMm));
    assert.deepEqual(validateProfile(profile), {
      id: profile.id,
      name: profile.name,
      version: 1,
      marginsMm: { left: 30, right: 15, top: 20, bottom: 20 },
      fontFamily: 'Times New Roman',
      minFontPt: profile.minFontPt,
      lineSpacing: 1.5,
      firstLineMm: 12.5,
      alignment: 'justify',
    });
  }
  assert.equal(BUILTIN_PROFILES[0].minFontPt, 12);
  assert.equal(BUILTIN_PROFILES[1].minFontPt, 14);
  assert.equal(isBuiltinProfileId('gost-7.32-2017'), true);
  assert.equal(isBuiltinProfileId('method-14'), true);
  assert.equal(isBuiltinProfileId('my-profile'), false);
  assert.equal(isBuiltinProfile('gost-7.32-2017'), true);

  assert.throws(() => {
    BUILTIN_PROFILES[0].name = 'Изменённый';
  }, TypeError);
  assert.throws(() => {
    BUILTIN_PROFILES[0].marginsMm.left = 1;
  }, TypeError);
  assert.throws(() => {
    BUILTIN_PROFILES.push({});
  }, TypeError);
});

test('listProfiles отдаёт копии: встроенные профили нельзя испортить', () => {
  const storage = createMemoryStorage();
  const listed = listProfiles(storage);
  assert.equal(listed.length, 2);
  listed[0].marginsMm.left = 99;
  listed[0].name = 'Испорченный';
  listed[1].fontFamily = 'Arial';

  const again = listProfiles(storage);
  assert.equal(again[0].marginsMm.left, 30);
  assert.equal(again[0].name, 'ГОСТ 7.32-2017');
  assert.equal(again[1].fontFamily, 'Times New Roman');
  assert.equal(BUILTIN_PROFILES[0].marginsMm.left, 30);
  assert.deepEqual(validateProfile(again[0]), validateProfile(BUILTIN_PROFILES[0]));
});

test('validateProfile отклоняет неверные поля с кодом INVALID_PROFILE', () => {
  const { marginsMm, ...withoutMargins } = makeProfile();
  expectInvalidProfile(() => validateProfile(withoutMargins), ['marginsMm']);

  expectInvalidProfile(
    () =>
      validateProfile(
        makeProfile({
          marginsMm: { left: -1, right: 15, top: 20, bottom: 20 },
        }),
      ),
    ['marginsMm.left'],
  );

  expectInvalidProfile(
    () => validateProfile(makeProfile({ minFontPt: Number.NaN })),
    ['minFontPt'],
  );
  expectInvalidProfile(
    () => validateProfile(makeProfile({ lineSpacing: Number.POSITIVE_INFINITY })),
    ['lineSpacing'],
  );
  expectInvalidProfile(
    () => validateProfile(makeProfile({ firstLineMm: Number.NEGATIVE_INFINITY })),
    ['firstLineMm'],
  );
  expectInvalidProfile(
    () => validateProfile(makeProfile({ alignment: 'middle' })),
    ['alignment'],
  );
  expectInvalidProfile(() => validateProfile(makeProfile({ version: 2 })), [
    'version',
  ]);
  expectInvalidProfile(
    () => validateProfile(makeProfile({ id: 'плохой id' })),
    ['id'],
  );
  expectInvalidProfile(
    () => validateProfile(makeProfile({ name: '   ' })),
    ['name'],
  );
  expectInvalidProfile(() => validateProfile(null), ['profile']);
  expectInvalidProfile(() => validateProfile([]), ['profile']);
  expectInvalidProfile(() => validateProfile('profile'), ['profile']);
  expectInvalidProfile(() => validateProfile(new Date()), ['profile']);

  expectInvalidProfile(
    () => saveProfile(makeProfile({ id: 'gost-7.32-2017' }), createMemoryStorage()),
    ['id'],
  );
});

test('validateProfile возвращает нормализованную копию только со схемой', () => {
  const input = makeProfile({
    name: '  Мой профиль  ',
    fontFamily: '  Times New Roman  ',
    extra: 'лишнее',
    marginsMm: { left: 30, right: 15, top: 20, bottom: 20, extra: 1 },
  });
  const normalized = validateProfile(input);
  assert.deepEqual(normalized, makeProfile({ name: 'Мой профиль' }));
  assert.equal('extra' in normalized, false);
  assert.equal('extra' in normalized.marginsMm, false);
  assert.notEqual(normalized, input);
  assert.notEqual(normalized.marginsMm, input.marginsMm);
  assert.equal(PROFILE_SCHEMA_VERSION, 1);
  assert.deepEqual(ALIGNMENTS, ['left', 'center', 'right', 'justify']);
  assert.ok(Object.isFrozen(ALIGNMENTS));
});

test('save/list/get сохраняют и заменяют профиль по id', () => {
  const storage = createMemoryStorage();
  assert.equal(listProfiles(storage).length, 2);

  const saved = saveProfile(makeProfile(), storage);
  assert.deepEqual(saved, makeProfile());
  assert.notEqual(saved, makeProfile());

  const envelope = JSON.parse(storage.raw());
  assert.equal(envelope.version, 1);
  assert.equal(envelope.profiles.length, 1);
  assert.equal(envelope.profiles[0].id, 'my-profile');

  let all = listProfiles(storage);
  assert.equal(all.length, 3);
  assert.deepEqual(
    all.map((profile) => profile.id),
    ['gost-7.32-2017', 'method-14', 'my-profile'],
  );

  const fetched = getProfile('my-profile', storage);
  assert.deepEqual(fetched, makeProfile());
  fetched.name = 'Испорченная копия';
  assert.equal(getProfile('my-profile', storage).name, 'Мой профиль');
  assert.equal(getProfile('missing', storage), null);

  saveProfile(makeProfile({ name: 'Обновлённый профиль', minFontPt: 14 }), storage);
  all = listProfiles(storage);
  assert.equal(all.length, 3, 'профиль с тем же id должен замениться');
  assert.equal(all[2].name, 'Обновлённый профиль');
  assert.equal(all[2].minFontPt, 14);
  assert.equal(
    JSON.parse(storage.raw()).profiles.filter(
      (profile) => profile.id === 'my-profile',
    ).length,
    1,
  );

  saveProfile(makeProfile({ id: 'second-profile', name: 'Второй' }), storage);
  assert.equal(listProfiles(storage).length, 4);
});

test('export → import: пользовательский профиль заменяется, имя сохраняется', async () => {
  const storage = createMemoryStorage();
  const saved = saveProfile(
    makeProfile({ id: 'custom-profile', name: 'Свой профиль' }),
    storage,
  );

  const text = exportProfile('custom-profile', storage);
  assert.equal(typeof text, 'string');
  assert.deepEqual(JSON.parse(text), saved);
  assert.ok(text.includes('\n  '), 'JSON должен быть отформатирован');
  expectInvalidProfile(() => exportProfile('unknown-profile', storage), ['id']);

  const otherStorage = createMemoryStorage();
  const imported = await importProfile(text, otherStorage);
  assert.deepEqual(imported, saved);
  assert.deepEqual(getProfile('custom-profile', otherStorage), saved);
  assert.equal(listProfiles(otherStorage).length, 3);

  saveProfile({ ...saved, name: 'Переименованный локально' }, storage);
  const countBefore = listProfiles(storage).length;
  const replaced = await importProfile(text, storage);
  assert.equal(replaced.name, 'Свой профиль');
  assert.equal(getProfile('custom-profile', storage).name, 'Свой профиль');
  assert.equal(listProfiles(storage).length, countBefore);
});

test('import профиля со встроенным id создаёт уникальный пользовательский id', async () => {
  const storage = createMemoryStorage();
  const text = JSON.stringify(BUILTIN_PROFILES[0]);

  const first = await importProfile(text, storage);
  assert.equal(first.name, 'ГОСТ 7.32-2017');
  assert.notEqual(first.id, 'gost-7.32-2017');
  assert.equal(isBuiltinProfileId(first.id), false);
  assert.match(first.id, /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
  assert.equal(first.id, 'gost-7-32-2017-copy');
  assert.equal(listProfiles(storage).length, 3);
  assert.deepEqual(getProfile(first.id, storage), first);

  const second = await importProfile(
    { text: async () => JSON.stringify(BUILTIN_PROFILES[0]) },
    storage,
  );
  assert.notEqual(second.id, first.id);
  assert.equal(second.id, 'gost-7-32-2017-copy-2');
  assert.equal(listProfiles(storage).length, 4);
});

test('import отклоняет повреждённый JSON и неверный профиль', async () => {
  const storage = createMemoryStorage();
  await assert.rejects(
    () => importProfile('{ это не json', storage),
    (error) => {
      assert.ok(error instanceof DocLintError);
      assert.equal(error.code, ERROR_CODES.INVALID_PROFILE);
      assert.ok(Array.isArray(error.details));
      return true;
    },
  );
  await assert.rejects(
    () => importProfile(JSON.stringify(makeProfile({ version: 2 })), storage),
    (error) => {
      assert.ok(error instanceof DocLintError);
      assert.equal(error.code, ERROR_CODES.INVALID_PROFILE);
      return true;
    },
  );
  await assert.rejects(
    () => importProfile(42, storage),
    (error) => {
      assert.ok(error instanceof DocLintError);
      assert.equal(error.code, ERROR_CODES.INVALID_PROFILE);
      return true;
    },
  );
  assert.equal(listProfiles(storage).length, 2);
});

test('повреждённое хранилище не ломает список профилей', () => {
  assert.equal(listProfiles(createMemoryStorage('{ битый json')).length, 2);
  assert.equal(
    listProfiles(createMemoryStorage(JSON.stringify({ version: 1 }))).length,
    2,
  );
  assert.equal(
    listProfiles(
      createMemoryStorage(
        JSON.stringify({
          version: 2,
          profiles: [makeProfile()],
        }),
      ),
    ).length,
    2,
  );
  assert.equal(getProfile('my-profile', createMemoryStorage(']')), null);

  const throwingStorage = {
    getItem() {
      throw new Error('Storage недоступен');
    },
    setItem() {
      throw new Error('Storage недоступен');
    },
  };
  assert.equal(listProfiles(throwingStorage).length, 2);
  assert.equal(
    listProfiles(
      createMemoryStorage(
        JSON.stringify({ version: 1, profiles: [makeProfile()] }),
      ),
    ).length,
    3,
  );
});

test('formatProfileSummary выдаёт точную русскую строку', () => {
  assert.equal(
    formatProfileSummary(BUILTIN_PROFILES[0]),
    'Поля 30/15/20/20 мм · Times New Roman, ≥12 пт · интервал 1,5 · отступ 12,5 мм · по ширине',
  );
  assert.equal(
    formatProfileSummary(BUILTIN_PROFILES[1]),
    'Поля 30/15/20/20 мм · Times New Roman, ≥14 пт · интервал 1,5 · отступ 12,5 мм · по ширине',
  );

  const withoutIndent = makeProfile({
    firstLineMm: 0,
    alignment: 'center',
    marginsMm: { left: 20, right: 10, top: 20, bottom: 20 },
    minFontPt: 14,
    lineSpacing: 1,
    fontFamily: 'Arial',
  });
  assert.equal(
    formatProfileSummary(withoutIndent),
    'Поля 20/10/20/20 мм · Arial, ≥14 пт · интервал 1 · отступ 0 мм · по центру',
  );

  assert.equal(
    formatProfileSummary(makeProfile({ alignment: 'left' })),
    'Поля 30/15/20/20 мм · Times New Roman, ≥12 пт · интервал 1,5 · отступ 12,5 мм · по левому краю',
  );
  assert.equal(
    formatProfileSummary(makeProfile({ alignment: 'right' })),
    'Поля 30/15/20/20 мм · Times New Roman, ≥12 пт · интервал 1,5 · отступ 12,5 мм · по правому краю',
  );
});

test('подсказки покрывают все правила и имеют запасной вариант', () => {
  assert.deepEqual(Object.keys(RULE_LABELS).sort(), RULE_IDS.slice().sort());
  assert.deepEqual(Object.keys(RULE_HINTS).sort(), RULE_IDS.slice().sort());
  assert.equal(RULE_LABELS['margin.left'], 'Левое поле');
  assert.equal(RULE_LABELS['font.size'], 'Размер шрифта');
  assert.equal(RULE_LABELS['spacing.line'], 'Междустрочный интервал');
  assert.equal(RULE_LABELS['indent.firstLine'], 'Абзацный отступ');
  assert.equal(RULE_LABELS.alignment, 'Выравнивание');

  for (const ruleId of RULE_IDS) {
    assert.equal(hintFor(ruleId), RULE_HINTS[ruleId]);
    assert.ok(RULE_HINTS[ruleId].includes('→'), `путь меню для ${ruleId}`);
  }
  assert.equal(
    RULE_HINTS['margin.right'],
    'Макет → Поля → Настроить поля → Правое: 15 мм',
  );
  const fallback = hintFor('unknown.rule');
  assert.equal(typeof fallback, 'string');
  assert.ok(fallback.length > 0);
  assert.notEqual(fallback, RULE_HINTS.alignment);
  assert.ok(Object.isFrozen(RULE_LABELS));
  assert.ok(Object.isFrozen(RULE_HINTS));
});
