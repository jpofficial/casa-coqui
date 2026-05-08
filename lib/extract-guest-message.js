'use strict';

// ---------------------------------------------------------------------------
// extract-guest-message.js
//
// Strip Airbnb's email boilerplate from a stored airbnb_messages.body so the
// admin Messages tab preview shows the actual guest text instead of tracking
// pixels and listing details.
//
// Two source patterns:
//   A) RE: replies (express@airbnb.com threaded conversations) — anchored on
//      the "For your protection and safety, always communicate through Airbnb
//      [URL]." disclaimer that precedes the message.
//   B) Initial inquiries (booking/inquiry emails) — anchored on
//      "RESPOND TO X'S INQUIRY" header followed by the thread URL, then
//      profile-metadata lines (varies by guest: Identity verified, On Airbnb
//      since YYYY, Joined, N reviews, City Country).
//
// Verified against 36 real airbnb_messages.body strings: 36/36 clean.
// ---------------------------------------------------------------------------

function extractGuestMessage(body) {
  if (!body) return '';
  let s = String(body);
  let after;

  // Pattern A — RE: replies start AFTER the safety disclaimer line + closing URL
  const replyMatch = s.match(/For your protection and safety[\s\S]*?\]\s*\.\s*\n+/);
  if (replyMatch) {
    after = s.slice(replyMatch.index + replyMatch[0].length);
  } else {
    // Pattern B — initial inquiries: anchor on "RESPOND TO X'S INQUIRY", then
    // skip past the bracketed thread URL and the profile-metadata stanza.
    const inquiryUrlMatch = s.match(/RESPOND TO[\s\S]*?\]\s*\n+/);
    if (inquiryUrlMatch) {
      after = s.slice(inquiryUrlMatch.index + inquiryUrlMatch[0].length);

      const isMetadata = (line) => {
        const t = line.trim();
        if (!t) return true;
        if (/^Identity verified/i.test(t)) return true;
        if (/^On Airbnb since/i.test(t)) return true;
        if (/^Joined/i.test(t)) return true;
        if (/^\d+\s+reviews?\b/i.test(t)) return true;
        if (/^[A-Z][a-zA-Z\s]+,\s*[A-Z]/.test(t) && t.length < 60) return true;
        return false;
      };
      const lines = after.split('\n');
      let i = 0;
      while (i < lines.length && isMetadata(lines[i])) i++;
      after = lines.slice(i).join('\n');
    } else {
      after = s;
    }
  }

  // Stop at the first end-marker.
  const stopMatch = after.match(
    /\n\s*Reply\s*\n|You can also respond|\n\s*https?:\/\/www\.airbnb\.com\/rooms\/|Pre-approve\s*\/\s*Decline|Review inquiry/
  );
  if (stopMatch) after = after.slice(0, stopMatch.index);

  // Skip ALL-CAPS GUEST_NAME + 'Booker'/'Host' role labels at start.
  after = after.replace(
    /^\s*[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s\-']+\n\s*\n\s*(Booker|Host|Co-host|Guest)\n\s*\n+/,
    ''
  );

  // De-indent (Airbnb wraps message body with 3-space indent).
  after = after.split('\n').map((line) => line.replace(/^   /, '')).join('\n');

  // Collapse 3+ blank lines, trim.
  return after.replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { extractGuestMessage };
