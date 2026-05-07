'use strict';

// ---------------------------------------------------------------------------
// anthropic-with-backoff.js
//
// Thin wrapper around `client.messages.create()` that adds explicit
// exponential backoff with full jitter for 429 / 529 / 5xx responses.
// Replaces the SDK's silent built-in retries with logged retries we can
// observe. This is Phase 0 of the Casa Coqui Step Functions refactor —
// the same retry semantics will become the inner step retry config when
// we move the chain into SFN Express.
//
// Backoff formula: min(2^attempt * 500ms + rand(0, 500ms), 30000ms).
// Max 5 attempts (attempt 0 = first try, then up to 4 retries). After
// exhaustion, the last error is re-thrown so callers can fall through
// to single-shot fallback or mark drafts as errored.
//
// Usage:
//   const { createWithBackoff } = require('./anthropic-with-backoff');
//   const response = await createWithBackoff(client, params, {
//     label: 'reasoner',          // optional — appears in retry log lines
//     refId: messageId,           // optional — appears in retry log lines
//   });
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

/**
 * @returns true if the error looks transient and worth retrying.
 *   - 429 — rate limit
 *   - 529 — overloaded (Anthropic-specific)
 *   - 5xx — server error
 *   - network errors without a status (ECONNRESET, ETIMEDOUT, etc.)
 */
function isRetryable(err) {
  if (!err) return false;
  const status = err.status ?? err.statusCode ?? null;
  if (status === 429) return true;
  if (status === 529) return true;
  if (status >= 500 && status < 600) return true;
  // Network-level errors from the SDK have no status but specific codes.
  const code = err.code || err.cause?.code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') return true;
  return false;
}

/**
 * Sleep for `ms` milliseconds. Pulled out so tests can stub it.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute the backoff delay for a given attempt index (0-based).
 * Full jitter — adds a uniform random in [0, BASE_DELAY_MS).
 */
function backoffDelayMs(attempt) {
  const exponential = Math.pow(2, attempt) * BASE_DELAY_MS;
  const jitter = Math.random() * BASE_DELAY_MS;
  return Math.min(exponential + jitter, MAX_DELAY_MS);
}

/**
 * Call client.messages.create(params) with explicit retry.
 *
 * @param {object} client — Anthropic SDK client
 * @param {object} params — same shape as client.messages.create(params)
 * @param {object} [opts]
 * @param {string} [opts.label] — appears in retry log lines (e.g. 'reasoner')
 * @param {string} [opts.refId] — appears in retry log lines (e.g. messageId)
 * @param {function} [opts.sleepFn] — override for tests (default: setTimeout)
 * @returns {Promise<object>} — the SDK response
 * @throws — the last error after MAX_ATTEMPTS, or any non-retryable error
 */
async function createWithBackoff(client, params, opts = {}) {
  const label = opts.label || 'anthropic';
  const refId = opts.refId || '';
  const sleepFn = opts.sleepFn || sleep;

  let lastErr;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err) {
      lastErr = err;
      const status = err.status ?? err.statusCode ?? null;

      if (!isRetryable(err)) {
        // Non-retryable — re-throw immediately
        console.warn(
          `[${label}${refId ? ' ' + refId : ''}] Non-retryable error (status=${status}): ${err.message}`
        );
        throw err;
      }

      if (attempt + 1 >= MAX_ATTEMPTS) {
        console.error(
          `[${label}${refId ? ' ' + refId : ''}] Retry budget exhausted after ${MAX_ATTEMPTS} attempts (last status=${status}): ${err.message}`
        );
        throw err;
      }

      const delay = backoffDelayMs(attempt);
      console.warn(
        `[${label}${refId ? ' ' + refId : ''}] Attempt ${attempt + 1}/${MAX_ATTEMPTS} failed (status=${status}). Retrying in ${Math.round(delay)}ms.`
      );
      await sleepFn(delay);
    }
  }

  // Defensive — loop above should always either return or throw
  throw lastErr;
}

module.exports = {
  createWithBackoff,
  // Exported for tests
  isRetryable,
  backoffDelayMs,
  MAX_ATTEMPTS,
  BASE_DELAY_MS,
  MAX_DELAY_MS,
};
