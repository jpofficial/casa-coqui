'use strict';

// ---------------------------------------------------------------------------
// reorderCheck.js
//
// Scheduled Cloud Function — runs on a configurable cron schedule (default:
// daily at 9 AM America/Puerto_Rico time).
//
// Logic:
//   1. Query all documents in the `supplies` collection.
//   2. Filter for items where quantity <= minimum AND autoReorder === true.
//   3. If any low-stock items are found:
//      a. Build an Amazon cart URL using the ASINs extracted from each item's
//         amazonUrl field.
//      b. Send a push notification to the admin via FCM.
//         — Looks up admin FCM token from `fcm_tokens` where bookingCode == 'admin'.
//         — Falls back to the FCM topic 'admin' if no token doc exists.
//      c. Log the cart URL and item list.
//   4. If no low-stock items, log and exit cleanly.
//
// Firestore `supplies` document shape:
//   name        {string}   display name
//   quantity    {number}   current stock level
//   minimum     {number}   threshold below which we reorder
//   amazonUrl   {string}   full Amazon product/ASIN URL
//   autoReorder {boolean}  opt-in flag
//   createdAt   {string}   ISO timestamp
// ---------------------------------------------------------------------------

const { db, messaging } = require('./firebaseInit');

// Regex to pull an ASIN out of any Amazon URL.
// ASINs are 10-character alphanumeric strings that appear after /dp/, /gp/product/,
// or as the last segment before a query string.
const ASIN_RE = /(?:\/dp\/|\/gp\/product\/|\/ASIN\/)([A-Z0-9]{10})/i;

/**
 * Extracts the ASIN from an Amazon product URL.
 * Returns null if the URL does not contain a recognizable ASIN.
 *
 * @param {string} url
 * @returns {string|null}
 */
function extractAsin(url) {
  if (!url) return null;
  const match = url.match(ASIN_RE);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Builds an Amazon "Add to Cart" URL for multiple ASINs.
 * Format: https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=XXX&Quantity.1=1&...
 *
 * Items without a parseable ASIN are silently skipped.
 *
 * @param {Array<{ name: string, amazonUrl: string }>} items
 * @returns {string|null}  URL string, or null if no ASINs could be parsed
 */
function buildCartUrl(items) {
  const params = [];
  let index = 1;

  for (const item of items) {
    const asin = extractAsin(item.amazonUrl);
    if (!asin) {
      console.warn(`[reorderCheck] Could not parse ASIN from URL for "${item.name}": ${item.amazonUrl}`);
      continue;
    }
    params.push(`ASIN.${index}=${encodeURIComponent(asin)}`);
    params.push(`Quantity.${index}=1`);
    index++;
  }

  if (params.length === 0) return null;
  return `https://www.amazon.com/gp/aws/cart/add.html?${params.join('&')}`;
}

/**
 * Sends a push notification to the admin.
 * Prefers the FCM token stored in `fcm_tokens` where bookingCode == 'admin'.
 * Falls back to sending to the FCM topic 'admin' if no token doc is found.
 *
 * @param {string} title
 * @param {string} body        Must fit in 160 chars for SMS compatibility.
 * @param {Object} data        Key/value pairs included in the FCM data payload.
 * @returns {Promise<void>}
 */
async function notifyAdmin(title, body, data = {}) {
  // Stringify all data values — FCM requires string-only data payloads.
  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );

  // Look up a stored admin FCM token.
  const tokenSnap = await db
    .collection('fcm_tokens')
    .where('bookingCode', '==', 'admin')
    .limit(1)
    .get();

  if (!tokenSnap.empty) {
    const { token } = tokenSnap.docs[0].data();
    console.log('[reorderCheck] Sending push to admin FCM token');
    await messaging.send({
      token,
      data: { ...stringData, title: String(title), body: String(body) },
    });
  } else {
    // Fallback: broadcast to the 'admin' FCM topic.
    // The admin device must subscribe to this topic on first login.
    console.log('[reorderCheck] No admin token doc found — sending to topic "admin"');
    await messaging.send({
      topic: 'admin',
      data: { ...stringData, title: String(title), body: String(body) },
    });
  }
}

/**
 * Main handler — called by the scheduled Cloud Function in index.js.
 *
 * @returns {Promise<{ checked: number, lowStock: number, notified: boolean }>}
 */
async function reorderCheckHandler() {
  console.log('[reorderCheck] Starting supply level check');

  // 1. Fetch all supply documents.
  const suppliesSnap = await db.collection('supplies').get();
  const totalChecked = suppliesSnap.size;

  console.log(`[reorderCheck] Checking ${totalChecked} supply item(s)`);

  // 2. Filter for low-stock, auto-reorder items.
  const lowStockItems = [];
  for (const doc of suppliesSnap.docs) {
    const supply = doc.data();
    const { name, quantity, minimum, autoReorder, amazonUrl } = supply;

    // Guard against malformed documents.
    if (typeof quantity !== 'number' || typeof minimum !== 'number') {
      console.warn(`[reorderCheck] Skipping "${name}" — quantity or minimum is not a number`);
      continue;
    }

    if (autoReorder === true && quantity <= minimum) {
      console.log(`[reorderCheck] LOW STOCK: "${name}" qty=${quantity} min=${minimum}`);
      lowStockItems.push({ name, quantity, minimum, amazonUrl: amazonUrl || '' });
    }
  }

  if (lowStockItems.length === 0) {
    console.log('[reorderCheck] All supplies are adequately stocked — no action needed');
    return { checked: totalChecked, lowStock: 0, notified: false };
  }

  console.log(`[reorderCheck] ${lowStockItems.length} item(s) need reordering:`,
    lowStockItems.map((i) => i.name).join(', '));

  // 3. Build Amazon cart URL.
  const cartUrl = buildCartUrl(lowStockItems);
  if (cartUrl) {
    console.log('[reorderCheck] Amazon cart URL:', cartUrl);
  } else {
    console.warn('[reorderCheck] Could not build cart URL — no valid ASINs found');
  }

  // 4. Build notification strings.
  // Body must stay under 160 characters for single-segment SMS pricing.
  const itemNames = lowStockItems.map((i) => i.name).join(', ');
  const notifBody = `Low stock: ${itemNames}`.slice(0, 155); // leave room for ellipsis
  const notifTitle = 'Supplies Running Low';

  const notifData = {
    type: 'reorder',
    itemCount: String(lowStockItems.length),
    cartUrl: cartUrl || '',
  };

  // 5. Send notification to admin.
  try {
    await notifyAdmin(notifTitle, notifBody, notifData);
    console.log('[reorderCheck] Admin notification sent successfully');
  } catch (notifErr) {
    // Log the error but do not throw — we already know about the low-stock situation.
    console.error('[reorderCheck] Failed to send admin notification:', notifErr);
  }

  return { checked: totalChecked, lowStock: lowStockItems.length, notified: true };
}

module.exports = { reorderCheckHandler };
