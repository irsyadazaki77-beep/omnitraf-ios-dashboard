/**
 * Standardized Error Response Contract Helper & Sanitizers
 */

export function createApiErrorResponse(statusCode, code, message, details = {}, type = "error") {
  return {
    success: false,
    type,
    timestamp: Date.now(),
    requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    code,
    message,
    retryable: statusCode >= 500 || statusCode === 429,
    details
  };
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
