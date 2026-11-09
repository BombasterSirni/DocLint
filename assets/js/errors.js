/**
 * Единый формат ошибок DocLint: {code, message, details}.
 * Коды зафиксированы в ТЗ (раздел 3.1).
 */

export const ERROR_CODES = Object.freeze({
  INVALID_FILE: 'INVALID_FILE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_DOCX: 'INVALID_DOCX',
  INVALID_PROFILE: 'INVALID_PROFILE',
  CHECK_FAILED: 'CHECK_FAILED',
});

export class DocLintError extends Error {
  /**
   * @param {string} code один из ERROR_CODES
   * @param {string} message понятное пользователю сообщение
   * @param {unknown} [details] технические детали для консоли/тестов
   */
  constructor(code, message, details = null) {
    super(message);
    this.name = 'DocLintError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/** Приводит любую ошибку к DocLintError, не теряя исходную причину. */
export function asDocLintError(error, code = ERROR_CODES.CHECK_FAILED) {
  if (error instanceof DocLintError) return error;
  const message = error && typeof error.message === 'string' ? error.message : String(error);
  return new DocLintError(code, message, error);
}
