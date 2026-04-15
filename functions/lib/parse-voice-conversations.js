'use strict';

/**
 * Parse Airbnb voice-sample markdown files into guest→host conversation pairs.
 *
 * Markdown format (two variants):
 *   Older: ## DATE TIME — Guest / ## DATE TIME — Host
 *   Newer: ## DATE — Guest (TIME) / ## DATE — Host (TIME)
 *
 * YAML frontmatter provides metadata (guest name, listing, dates, etc.).
 *
 * Returns an array of { guestMessage, hostReply, ...metadata } objects,
 * one per guest→host exchange. Consecutive guest messages are merged
 * before the host reply.
 */

// ---------------------------------------------------------------------------
// Frontmatter parser (no dependency — simple YAML-ish key: value)
// ---------------------------------------------------------------------------

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { meta: {}, body: text };

  const meta = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val === 'None' || val === 'null' || val === '') val = null;
    meta[key] = val;
  }

  const body = text.slice(match[0].length).trim();
  return { meta, body };
}

// ---------------------------------------------------------------------------
// Message parser
// ---------------------------------------------------------------------------

// Matches: ## 2026-03-23 — Host (3:14 PM)  OR  ## 2025-03-08 04:13 — Guest
const HEADER_RE = /^## (\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?\s*—\s*(Guest|Host)(?:\s*\(([^)]+)\))?/;

function parseMessages(body) {
  const lines = body.split('\n');
  const messages = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(HEADER_RE);
    if (m) {
      if (current) messages.push(current);
      current = {
        date: m[1],
        time: m[4] || m[2] || null, // prefer parenthesized time, fall back to inline
        speaker: m[3].toLowerCase(), // 'guest' or 'host'
        lines: [],
      };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) messages.push(current);

  // Join lines and clean up
  return messages.map((msg) => ({
    ...msg,
    text: msg.lines.join('\n').trim(),
  }));
}

// ---------------------------------------------------------------------------
// Filter junk messages
// ---------------------------------------------------------------------------

function isJunk(text) {
  if (!text || text.length < 3) return true;
  // Reactions like "Reacted ❤️ to ..."
  if (/^(Booker\s+|Guest\s+|Host\s+)?Reacted\s+/i.test(text)) return true;
  // Image/video placeholders
  if (/^\[?(image|video|audio)\s*(sent|message)\]?$/i.test(text.trim())) return true;
  if (/^(Booker\s+|Guest\s+|Host\s+)?Image sent$/i.test(text.trim())) return true;
  return false;
}

/**
 * Strip Airbnb role prefixes like "Booker", "Guest", "Host" from message text.
 * These appear at the start of messages in some conversation exports.
 */
function stripRolePrefix(text) {
  return text.replace(/^(Booker|Guest|Host)\s+/gm, '').trim();
}

// ---------------------------------------------------------------------------
// Pair extraction — guest question → host answer
// ---------------------------------------------------------------------------

/**
 * Parse a markdown conversation file into guest→host pairs.
 *
 * @param {string} markdown - Full file content (with frontmatter)
 * @param {string} [s3Key] - S3 object key for provenance
 * @returns {{ pairs: Array<{guestMessage, hostReply, guestName, date, s3Key, listing, checkIn, checkOut, confirmationCode}>, meta: Object }}
 */
function parseConversation(markdown, s3Key = null) {
  const { meta, body } = parseFrontmatter(markdown);
  const messages = parseMessages(body);

  const pairs = [];
  let pendingGuestLines = [];
  let pendingDate = null;

  for (const msg of messages) {
    const cleaned = stripRolePrefix(msg.text);
    if (isJunk(cleaned)) continue;

    if (msg.speaker === 'guest') {
      pendingGuestLines.push(cleaned);
      if (!pendingDate) pendingDate = msg.date;
    } else if (msg.speaker === 'host' && pendingGuestLines.length > 0) {
      // Host reply found — create a pair
      pairs.push({
        guestMessage: pendingGuestLines.join('\n\n'),
        hostReply: cleaned,
        guestName: meta.guest || null,
        date: pendingDate || msg.date,
        s3Key,
        listing: meta.listing || null,
        checkIn: meta.checkIn || null,
        checkOut: meta.checkOut || null,
        confirmationCode: meta.confirmationCode || null,
      });
      pendingGuestLines = [];
      pendingDate = null;
    } else if (msg.speaker === 'host') {
      // Host message with no preceding guest message — skip (host-initiated)
      pendingGuestLines = [];
      pendingDate = null;
    }
  }

  return { pairs, meta };
}

module.exports = { parseConversation, parseFrontmatter, parseMessages };
