/**
 * Интерфейс DocLint: выбор профиля, загрузка .docx, прогресс, отчёт с
 * фильтрами и печатью. Вся логика проверки — в соседних модулях.
 */

import {
  checkDocument,
  MAX_FILE_MB,
  PROGRESS,
} from './file-reader.js';
import {
  listProfiles,
  getProfile,
  saveProfile,
  exportProfile,
  importProfile,
  validateProfile,
  formatProfileSummary,
  isBuiltinProfile,
} from './profiles.js';
import { BUILTIN_PROFILES } from './presets.js';
import { buildReportView, pluralize } from './report.js';
import { buildDemoDocx, DEMO_FILE_NAME, DEMO_MIME } from './demo.js';
import { DocLintError, ERROR_CODES } from './errors.js';

const PROGRESS_TEXT = Object.freeze({
  [PROGRESS.READ]: 'Читаем файл…',
  [PROGRESS.UNPACK]: 'Распаковываем .docx…',
  [PROGRESS.PARSE]: 'Разбираем стили и абзацы…',
  [PROGRESS.CHECK]: 'Сравниваем оформление с профилем…',
  [PROGRESS.DONE]: 'Готовим отчёт…',
});

const ACTION_BY_CODE = Object.freeze({
  [ERROR_CODES.INVALID_FILE]: 'Выберите файл Word в формате .docx.',
  [ERROR_CODES.FILE_TOO_LARGE]: `Уменьшите документ до ${MAX_FILE_MB} МБ и попробуйте снова.`,
  [ERROR_CODES.INVALID_DOCX]: 'Откройте файл в Word, сохраните как .docx и загрузите снова.',
  [ERROR_CODES.INVALID_PROFILE]: 'Проверьте JSON профиля: все обязательные поля должны быть заполнены.',
  [ERROR_CODES.CHECK_FAILED]: 'Обновите страницу и попробуйте снова.',
});

const state = {
  profiles: [],
  selectedId: null,
  report: null,
  view: null,
  filter: 'all',
  busy: false,
  fileName: '',
};

const dom = {};

function $(id) {
  return document.getElementById(id);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/* ---------- профили ---------- */

function fallbackProfiles() {
  return BUILTIN_PROFILES.map((profile) => JSON.parse(JSON.stringify(profile)));
}

function loadProfiles() {
  try {
    return listProfiles();
  } catch {
    return fallbackProfiles();
  }
}

function selectedProfile() {
  return state.profiles.find((profile) => profile.id === state.selectedId) || null;
}

function rebuildProfileSelect() {
  const select = dom.profileSelect;
  select.replaceChildren();

  const builtins = state.profiles.filter((profile) => isBuiltinProfile(profile.id));
  const custom = state.profiles.filter((profile) => !isBuiltinProfile(profile.id));

  const addGroup = (label, profiles) => {
    if (profiles.length === 0) return;
    const group = document.createElement('optgroup');
    group.label = label;
    for (const profile of profiles) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name;
      group.append(option);
    }
    select.append(group);
  };

  addGroup('Встроенные профили', builtins);
  addGroup('Мои профили', custom);

  if (!state.profiles.some((profile) => profile.id === state.selectedId)) {
    state.selectedId = state.profiles.length > 0 ? state.profiles[0].id : null;
  }
  if (state.selectedId) select.value = state.selectedId;
}

function updateProfileUi() {
  const profile = selectedProfile();
  if (!profile) {
    dom.profileNote.textContent = '';
    return;
  }
  const presetLabel = isBuiltinProfile(profile.id) ? ' · встроенный пресет' : ' · сохранён в этом браузере';
  dom.profileNote.textContent = `${formatProfileSummary(profile)}${presetLabel}`;
}

function refreshProfiles(preferredId = null) {
  state.profiles = loadProfiles();
  if (preferredId) state.selectedId = preferredId;
  rebuildProfileSelect();
  updateProfileUi();
}

function openProfileForm() {
  const base = selectedProfile();
  const draft = base
    ? JSON.parse(JSON.stringify(base))
    : {
      name: 'Профиль кафедры',
      marginsMm: { left: 30, right: 15, top: 20, bottom: 20 },
      fontFamily: 'Times New Roman',
      minFontPt: 14,
      lineSpacing: 1.5,
      firstLineMm: 12.5,
      alignment: 'justify',
    };

  dom.profileName.value = base ? `${base.name} (копия)` : draft.name;
  dom.marginLeft.value = draft.marginsMm.left;
  dom.marginRight.value = draft.marginsMm.right;
  dom.marginTop.value = draft.marginsMm.top;
  dom.marginBottom.value = draft.marginsMm.bottom;
  dom.fontFamily.value = draft.fontFamily;
  dom.minFontPt.value = draft.minFontPt;
  dom.lineSpacing.value = draft.lineSpacing;
  dom.firstLineMm.value = draft.firstLineMm;
  dom.alignment.value = draft.alignment;

  dom.profileFormError.hidden = true;
  dom.profileFormError.textContent = '';
  dom.profileFormTitle.textContent = base
    ? `Свой профиль на основе «${base.name}»`
    : 'Новый профиль кафедры';
  dom.profileForm.hidden = false;
  dom.profileName.focus();
}

function closeProfileForm() {
  dom.profileForm.hidden = true;
  dom.profileFormError.hidden = true;
  dom.profileFormError.textContent = '';
}

function uniqueCustomId() {
  const ids = new Set(state.profiles.map((profile) => profile.id));
  let id;
  do {
    id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  } while (ids.has(id));
  return id;
}

function readNumber(id) {
  return Number(dom[id].value);
}

function handleProfileSubmit(event) {
  event.preventDefault();

  const draft = {
    id: uniqueCustomId(),
    name: dom.profileName.value,
    version: 1,
    marginsMm: {
      left: readNumber('marginLeft'),
      right: readNumber('marginRight'),
      top: readNumber('marginTop'),
      bottom: readNumber('marginBottom'),
    },
    fontFamily: dom.fontFamily.value,
    minFontPt: readNumber('minFontPt'),
    lineSpacing: readNumber('lineSpacing'),
    firstLineMm: readNumber('firstLineMm'),
    alignment: dom.alignment.value,
  };

  try {
    const profile = validateProfile(draft);
    const saved = saveProfile(profile);
    closeProfileForm();
    refreshProfiles(saved.id);
    showStatus(`Профиль «${saved.name}» сохранён в этом браузере.`);
  } catch (error) {
    const message = error instanceof DocLintError
      ? error.message
      : 'Не удалось сохранить профиль. Проверьте поля и попробуйте снова.';
    dom.profileFormError.textContent = message;
    dom.profileFormError.hidden = false;
  }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function handleExport() {
  if (!state.selectedId) return;
  try {
    const profile = getProfile(state.selectedId);
    const json = exportProfile(state.selectedId);
    downloadText(`${profile.id}.json`, json);
    showStatus(`Профиль «${profile.name}» выгружен в файл ${profile.id}.json.`);
  } catch (error) {
    showError(error);
  }
}

async function handleImport(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;

  try {
    const profile = await importProfile(file);
    refreshProfiles(profile.id);
    showStatus(`Профиль «${profile.name}» импортирован и сохранён.`);
  } catch (error) {
    showError(error);
  }
}

/* ---------- проверка документа ---------- */

function setBusy(busy) {
  state.busy = busy;
  dom.btnBrowse.disabled = busy;
  dom.btnCheckSample.disabled = busy;
  dom.fileInput.disabled = busy;
  dom.dropzone.setAttribute('aria-disabled', busy ? 'true' : 'false');
  dom.status.classList.toggle('is-loading', busy);
}

function showStatus(text) {
  dom.status.hidden = false;
  dom.status.classList.remove('is-loading');
  dom.status.textContent = text;
  dom.errorBox.hidden = true;
}

function showProgress(stage) {
  dom.status.hidden = false;
  dom.status.classList.add('is-loading');
  dom.status.textContent = PROGRESS_TEXT[stage] || 'Проверяем документ…';
  dom.errorBox.hidden = true;
}

function hideStatus() {
  dom.status.hidden = true;
  dom.status.classList.remove('is-loading');
  dom.status.textContent = '';
}

function showError(error) {
  const docLintError = error instanceof DocLintError ? error : null;
  const message = docLintError ? docLintError.message : 'Не удалось выполнить действие. Попробуйте ещё раз.';
  const action = docLintError ? ACTION_BY_CODE[docLintError.code] : '';
  dom.errorBox.replaceChildren();
  dom.errorBox.append(el('p', 'error-message', message));
  if (action) dom.errorBox.append(el('p', 'error-action', action));
  dom.errorBox.hidden = false;
  dom.status.hidden = true;
  dom.status.classList.remove('is-loading');
}

function clearReport() {
  state.report = null;
  state.view = null;
  state.filter = 'all';
  dom.report.hidden = true;
  dom.reportCards.replaceChildren();
  dom.reportFilters.replaceChildren();
  dom.reportEmpty.hidden = true;
  dom.emptyState.hidden = false;
}

async function runCheck(file) {
  if (state.busy) return;
  const profile = selectedProfile();
  if (!profile) {
    showError(new DocLintError(ERROR_CODES.INVALID_PROFILE, 'Сначала выберите или создайте профиль требований.'));
    return;
  }

  state.fileName = file.name;
  clearReport();
  setBusy(true);
  showProgress(PROGRESS.READ);

  try {
    const report = await checkDocument(file, profile, {
      onProgress: showProgress,
    });
    state.report = report;
    state.view = buildReportView(report);
    renderReport(profile);
    dom.report.hidden = false;
    dom.emptyState.hidden = true;
    hideStatus();
    dom.report.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
    dom.fileInput.value = '';
  }
}

function handleFileInput(event) {
  const file = event.target.files && event.target.files[0];
  if (file) runCheck(file);
}

function handleDrop(event) {
  event.preventDefault();
  dom.dropzone.classList.remove('is-dragover');
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) runCheck(file);
}

async function handleSample() {
  if (state.busy) return;
  try {
    if (typeof globalThis.JSZip !== 'function') {
      throw new DocLintError(ERROR_CODES.CHECK_FAILED, 'Не загрузилась библиотека распаковки. Обновите страницу.');
    }
    const blob = await buildDemoDocx(globalThis.JSZip, 'blob');
    const file = new File([blob], DEMO_FILE_NAME, { type: DEMO_MIME });
    await runCheck(file);
  } catch (error) {
    showError(error);
  }
}

/* ---------- отчёт ---------- */

function pluralizeAbz(count) {
  return pluralize(count, ['абзац', 'абзаца', 'абзацев']);
}

function checkedSentence(count) {
  const last = Math.abs(count) % 100;
  const verb = last % 10 === 1 && last !== 11 ? 'Проверен' : 'Проверено';
  return `${verb} ${count} ${pluralizeAbz(count)}`;
}

function renderFilters() {
  const view = state.view;
  dom.reportFilters.replaceChildren();

  if (view.total === 0) {
    dom.reportFilters.hidden = true;
    return;
  }
  dom.reportFilters.hidden = false;

  const buttons = [
    { id: 'all', label: `Все (${view.total})` },
    ...view.categories.map((category) => ({
      id: category.id,
      label: `${category.label} (${category.count})`,
    })),
  ];

  for (const item of buttons) {
    const button = el('button', 'filter', item.label);
    button.type = 'button';
    button.dataset.filter = item.id;
    button.setAttribute('aria-pressed', state.filter === item.id ? 'true' : 'false');
    if (state.filter === item.id) button.classList.add('is-active');
    button.addEventListener('click', () => {
      state.filter = item.id;
      renderFilters();
      renderCards();
    });
    dom.reportFilters.append(button);
  }
}

function buildCard(group) {
  const card = el('article', 'card');

  const head = el('header', 'card-head');
  const place = group.isPageLevel
    ? 'Параметры страницы'
    : group.fromIndex === group.toIndex
      ? `Абзац ${group.fromIndex}`
      : `Абзацы ${group.fromIndex}–${group.toIndex}`;
  head.append(el('span', 'card-place', place));
  head.append(el('span', 'card-badge', group.categoryLabel));
  if (!group.isPageLevel && group.count > 1) {
    head.append(el('span', 'card-count', `${group.count} ${pluralizeAbz(group.count)}`));
  }
  card.append(head);

  if (!group.isPageLevel && group.preview) {
    card.append(el('p', 'card-preview', `«${group.preview}»`));
  }

  const values = el('dl', 'card-values');
  const actualRow = el('div');
  actualRow.append(el('dt', null, 'Найдено'));
  actualRow.append(el('dd', 'actual', group.actual));
  const expectedRow = el('div');
  expectedRow.append(el('dt', null, 'Требуется'));
  expectedRow.append(el('dd', 'expected', group.expected));
  values.append(actualRow, expectedRow);
  card.append(values);

  card.append(el('p', 'card-hint', `Как исправить: ${group.hint}`));
  return card;
}

function renderCards() {
  const view = state.view;
  dom.reportCards.replaceChildren();

  const groups = state.filter === 'all'
    ? view.groups
    : view.groups.filter((group) => group.category === state.filter);

  if (groups.length === 0) {
    dom.reportEmpty.hidden = false;
    dom.reportEmpty.textContent = 'В выбранной категории нарушений нет.';
  } else {
    dom.reportEmpty.hidden = true;
    for (const group of groups) {
      dom.reportCards.append(buildCard(group));
    }
  }
}

function renderReport(profile) {
  const report = state.report;
  const view = state.view;

  const metaParts = [
    `Профиль: «${profile.name}»`,
    `Файл: ${state.fileName}`,
    view.checkedLabel,
  ];
  if (view.skippedLabel) metaParts.push(view.skippedLabel);
  if (view.uncheckedLabel) metaParts.push(view.uncheckedLabel);
  dom.reportMeta.textContent = metaParts.join(' · ');
  dom.reportSummary.textContent = view.summary;

  renderFilters();
  renderCards();

  if (view.total === 0) {
    dom.reportEmpty.hidden = false;
    dom.reportEmpty.textContent = `${checkedSentence(report.totalChecked)}. `
      + 'Нарушений в проверяемых правилах нет. '
      + 'Титульный лист, заголовки, оглавление и таблицы в MVP не проверяются.';
  }
}

/* ---------- события ---------- */

function bindEvents() {
  dom.profileSelect.addEventListener('change', () => {
    state.selectedId = dom.profileSelect.value;
    updateProfileUi();
  });

  dom.btnNewProfile.addEventListener('click', openProfileForm);
  dom.btnCancelProfile.addEventListener('click', closeProfileForm);
  dom.profileForm.addEventListener('submit', handleProfileSubmit);
  dom.btnExportProfile.addEventListener('click', handleExport);
  dom.importProfileInput.addEventListener('change', handleImport);

  dom.fileInput.addEventListener('change', handleFileInput);
  dom.btnBrowse.addEventListener('click', () => dom.fileInput.click());
  dom.btnCheckSample.addEventListener('click', handleSample);

  dom.dropzone.addEventListener('click', (event) => {
    if (event.target.closest('button') || event.target === dom.fileInput) return;
    dom.fileInput.click();
  });
  let dragDepth = 0;
  dom.dropzone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    dom.dropzone.classList.add('is-dragover');
  });
  dom.dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  dom.dropzone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dom.dropzone.classList.remove('is-dragover');
  });
  dom.dropzone.addEventListener('drop', (event) => {
    dragDepth = 0;
    handleDrop(event);
  });

  dom.btnPrint.addEventListener('click', () => window.print());
}

function init() {
  const ids = [
    'profile-select', 'profile-note', 'profile-form', 'profile-form-title',
    'profile-name', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom',
    'font-family', 'min-font-pt', 'line-spacing', 'first-line-mm', 'alignment',
    'profile-form-error', 'btn-new-profile', 'btn-export-profile', 'import-profile-input',
    'btn-save-profile', 'btn-cancel-profile', 'dropzone', 'dropzone-hint',
    'file-input', 'btn-browse', 'btn-check-sample', 'status', 'error-box',
    'report', 'report-meta', 'report-summary', 'report-filters', 'report-cards',
    'report-empty', 'btn-print', 'empty-state',
  ];
  for (const id of ids) {
    dom[id] = document.getElementById(id);
  }
  Object.assign(dom, {
    profileSelect: dom['profile-select'],
    profileNote: dom['profile-note'],
    profileForm: dom['profile-form'],
    profileFormTitle: dom['profile-form-title'],
    profileFormError: dom['profile-form-error'],
    profileName: $('profile-name'),
    marginLeft: $('margin-left'),
    marginRight: $('margin-right'),
    marginTop: $('margin-top'),
    marginBottom: $('margin-bottom'),
    fontFamily: $('font-family'),
    minFontPt: $('min-font-pt'),
    lineSpacing: $('line-spacing'),
    firstLineMm: $('first-line-mm'),
    alignment: $('alignment'),
    btnNewProfile: $('btn-new-profile'),
    btnExportProfile: $('btn-export-profile'),
    btnSaveProfile: $('btn-save-profile'),
    btnCancelProfile: $('btn-cancel-profile'),
    importProfileInput: $('import-profile-input'),
    dropzone: $('dropzone'),
    fileInput: $('file-input'),
    btnBrowse: $('btn-browse'),
    btnCheckSample: $('btn-check-sample'),
    status: $('status'),
    errorBox: $('error-box'),
    report: $('report'),
    reportMeta: $('report-meta'),
    reportSummary: $('report-summary'),
    reportFilters: $('report-filters'),
    reportCards: $('report-cards'),
    reportEmpty: $('report-empty'),
    btnPrint: $('btn-print'),
    emptyState: $('empty-state'),
  });

  refreshProfiles();
  bindEvents();
  dom.errorBox.hidden = true;
  dom.status.hidden = true;
  dom.report.hidden = true;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker
    .register(new URL('../../sw.js', import.meta.url))
    .catch(() => {
      // Офлайн-режим не критичен для проверки; без SW страница работает как обычно.
    });
}

function bootstrap() {
  init();
  registerServiceWorker();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
