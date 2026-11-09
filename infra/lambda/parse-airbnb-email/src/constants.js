'use strict';

/**
 * Shared constants for the parse-airbnb-email Lambda.
 */

/**
 * Parser version stamped on every airbnb_messages / airbnb_messages_quarantine
 * doc this Lambda writes. Bump when changing extraction or thread-keying logic
 * so legacy docs are queryable and rollback is observable.
 */
const PARSER_VERSION = '2026-05-09';

module.exports = { PARSER_VERSION };
