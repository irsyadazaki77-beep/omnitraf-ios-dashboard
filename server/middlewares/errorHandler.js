/**
 * Standardized API Response & Error Contract Helpers & Sanitizers (Phase 16)
 */

export function createApiErrorResponse(statusCode, code, message, details = {}, type = "error") {
  const normalizedDetails = details || {};
  return {
    success: false,
    type,
    timestamp: Date.now(),
    requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    code,
    message,
    retryable: statusCode >= 500 || statusCode === 429,
    data: null,
    error: {
      code,
      message,
      details: normalizedDetails
    },
    details: normalizedDetails
  };
}

export function getCommandErrorStatus(error, fallbackStatus = 422) {
  return Number.isInteger(error?.statusCode) ? error.statusCode :
    (error?.code === 'NOT_FOUND' ? 404 : error?.code === 'FORBIDDEN' ? 403 :
      error?.code === 'STATE_CONFLICT' ? 409 : error?.code === 'PERSISTENCE_FAILED' ? 500 :
        error?.code === 'FAULT_INJECTION_PROHIBITED' ? 403 : fallbackStatus);
}

export function createCommandErrorResponse(error, fallbackStatus = 422) {
  const statusCode = getCommandErrorStatus(error, fallbackStatus);
  const code = error?.code || 'EXECUTION_FAIL';
  const details = error?.field ? { field: error.field, expected: error.expected, actual: error.actual } : (error?.details || {});
  return createApiErrorResponse(statusCode, code, error?.message || 'Command execution failed.', details);
}

export function createApiResponse({
  success = true,
  type = 'success',
  data = null,
  sequence = null,
  extra = {}
} = {}) {
  const resObj = {
    success: true,
    type,
    timestamp: Date.now(),
    data,
    error: null,
    extra: extra || {},
    ...extra
  };

  if (sequence !== null && sequence !== undefined) {
    resObj.sequence = sequence;
    resObj.version = sequence;
  }

  return resObj;
}

export function sanitizeCsvCell(value) {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  // CSV Formula Injection Prevention: Prepend single quote if cell starts with dangerous chars
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  str = str.replace(/"/g, '""');
  return `"${str}"`;
}

export function sanitizeString(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
