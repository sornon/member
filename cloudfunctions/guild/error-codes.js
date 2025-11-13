'use strict';

/**
 * Canonical error codes for the guild service. These codes follow the
 * `createError(code, message)` pattern shared with PVP/PVE cloud functions.
 */
const ERROR_CODES = Object.freeze({
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  RATE_LIMITED: 'RATE_LIMITED',
  ACTION_COOLDOWN: 'ACTION_COOLDOWN',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  INVALID_MEMBER: 'INVALID_MEMBER',
  INVALID_GUILD: 'INVALID_GUILD',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  INTERNAL_ERROR: 'GUILD_ACTION_FAILED'
});

module.exports = {
  ERROR_CODES
};
