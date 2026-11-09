/**
 * Приём файла и конвейер проверки:
 * тип/размер → JSZip → document.xml/styles.xml/theme1.xml → стили → правила.
 * Файл никуда не отправляется: используются только локальные API браузера.
 */

import { parseXml } from './xml.js';
import { buildStyleContext } from './style-resolver.js';
import { parseDocumentXml } from './docx-parser.js';
import { checkRules } from './rules.js';
import { buildReportView } from './report.js';
import { validateProfile } from './profiles.js';
import { DocLintError, ERROR_CODES, asDocLintError } from './errors.js';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILE_MB = 20;
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const PROGRESS = Object.freeze({
  READ: 'read',
  UNPACK: 'unpack',
  PARSE: 'parse',
  CHECK: 'check',
  DONE: 'done',
});

function emit(options, stage) {
  if (options && typeof options.onProgress === 'function') {
    options.onProgress(stage);
  }
}

/** Даёт браузеру отрисовать очередной этап перед синхронным разбором. */
function nextTask() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function validateFile(file) {
  if (!file || typeof file.name !== 'string') {
    throw new DocLintError(ERROR_CODES.INVALID_FILE, 'Не удалось прочитать файл. Выберите .docx ещё раз.');
  }

  const name = file.name;
  if (/\.doc$/i.test(name)) {
    throw new DocLintError(
      ERROR_CODES.INVALID_FILE,
      `Файл «${name}» сохранён в старом формате .doc. Откройте его в Word и сохраните как .docx.`,
    );
  }
  if (!/\.docx$/i.test(name)) {
    throw new DocLintError(
      ERROR_CODES.INVALID_FILE,
      `Файл «${name}» не является документом .docx. Выберите файл Word в формате .docx.`,
    );
  }

  if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
    throw new DocLintError(
      ERROR_CODES.FILE_TOO_LARGE,
      `Файл больше ${MAX_FILE_MB} МБ. Уменьшите документ (например, сожмите изображения) и попробуйте снова.`,
      { size: file.size, limit: MAX_FILE_BYTES },
    );
  }

  if (typeof file.size === 'number' && file.size === 0) {
    throw new DocLintError(ERROR_CODES.INVALID_DOCX, 'Файл пуст. Выберите другой .docx.');
  }
}

async function readPart(zip, path) {
  const entry = zip.file(path);
  if (!entry) return null;
  return entry.async('string');
}

function findThemePath(zip) {
  if (zip.file('word/theme/theme1.xml')) return 'word/theme/theme1.xml';
  const match = zip.file(/^word\/theme\/theme\d+\.xml$/)[0];
  return match ? match.name : null;
}

async function unpackDocument(file, options) {
  const JSZipConstructor = (options && options.JSZip) || globalThis.JSZip;
  if (typeof JSZipConstructor !== 'function') {
    throw new DocLintError(
      ERROR_CODES.CHECK_FAILED,
      'Не загрузилась библиотека распаковки. Обновите страницу и попробуйте снова.',
    );
  }

  emit(options, PROGRESS.READ);
  let bytes;
  try {
    bytes = await file.arrayBuffer();
  } catch (error) {
    throw new DocLintError(
      ERROR_CODES.INVALID_FILE,
      'Не удалось прочитать файл. Выберите .docx ещё раз.',
      error,
    );
  }

  emit(options, PROGRESS.UNPACK);
  let zip;
  try {
    zip = await JSZipConstructor.loadAsync(bytes);
  } catch (error) {
    throw new DocLintError(
      ERROR_CODES.INVALID_DOCX,
      'Не удалось открыть архив .docx. Возможно, файл повреждён или сохранён не в Word.',
      error,
    );
  }

  let documentXml;
  let stylesXml;
  let themeXml;
  try {
    documentXml = await readPart(zip, 'word/document.xml');
    const themePath = findThemePath(zip);
    stylesXml = await readPart(zip, 'word/styles.xml');
    themeXml = themePath ? await readPart(zip, themePath) : null;
  } catch (error) {
    throw new DocLintError(
      ERROR_CODES.INVALID_DOCX,
      'Не удалось извлечь XML-части документа. Возможно, архив .docx повреждён.',
      error,
    );
  }

  if (!documentXml) {
    throw new DocLintError(
      ERROR_CODES.INVALID_DOCX,
      'В файле нет word/document.xml — это не документ Word .docx.',
    );
  }

  return { documentXml, stylesXml, themeXml };
}

/**
 * Проверяет .docx по профилю.
 * @param {File|Blob} file файл с именем
 * @param {object} profile профиль требований
 * @param {{onProgress?: Function, JSZip?: Function, parseXml?: Function, signal?: AbortSignal}} [options]
 * @returns {Promise<object>} Report
 */
export async function checkDocument(file, profile, options = {}) {
  const normalizedProfile = validateProfile(profile);
  validateFile(file);

  if (options.signal && options.signal.aborted) {
    throw new DocLintError(ERROR_CODES.CHECK_FAILED, 'Проверка отменена.');
  }

  const parse = options.parseXml || parseXml;

  try {
    const parts = await unpackDocument(file, options);

    emit(options, PROGRESS.PARSE);
    await nextTask();
    let context;
    let parsed;
    try {
      context = buildStyleContext({
        stylesXml: parts.stylesXml,
        themeXml: parts.themeXml,
        parseXml: parse,
      });
      parsed = parseDocumentXml(parts.documentXml, context, parse);
    } catch (error) {
      throw new DocLintError(
        ERROR_CODES.INVALID_DOCX,
        'Не удалось разобрать оформление документа. Проверьте, что файл открывается в Word.',
        error,
      );
    }

    emit(options, PROGRESS.CHECK);
    await nextTask();
    const report = checkRules(parsed, normalizedProfile);
    // Поле summary предусмотрено моделью Report (раздел 2.3 архитектуры);
    // человекочитаемый текст строит тот же модуль, что и интерфейс.
    const result = { ...report, summary: buildReportView(report).summary };
    emit(options, PROGRESS.DONE);
    return result;
  } catch (error) {
    throw asDocLintError(error);
  }
}
