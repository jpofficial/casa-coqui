/**
 * TCPN — True Cost Per Night
 *
 * Normalizes the total guest cost across listings with different cleaning fees.
 * Formula: (nightly_rate × nights + cleaning_fee) / nights
 *
 * Default assumed stay = 2 nights (most common for urban Airbnb).
 */

function computeTcpn(nightlyRate, cleaningFee = 0, nights = 2) {
  if (!nightlyRate || nightlyRate <= 0 || nights <= 0) return null;
  return Math.round(((nightlyRate * nights + cleaningFee) / nights) * 100) / 100;
}

/**
 * Compute total cost for a stay
 */
function computeTotalCost(nightlyRate, cleaningFee = 0, nights = 2) {
  if (!nightlyRate || nightlyRate <= 0) return null;
  return Math.round((nightlyRate * nights + cleaningFee) * 100) / 100;
}

/**
 * Reverse TCPN — given a target TCPN, compute the nightly rate needed
 */
function tcpnToNightlyRate(tcpn, cleaningFee = 0, nights = 2) {
  if (!tcpn || tcpn <= 0) return null;
  // tcpn = (rate * nights + fee) / nights
  // rate = tcpn - fee / nights
  return Math.round((tcpn - cleaningFee / nights) * 100) / 100;
}

/**
 * Compute the reference nights for TCPN calculation from a comp set.
 * Uses the mode (most common value) of min_nights across competitors.
 * Falls back to 2 if no min_nights data is available.
 */
function computeReferenceNights(competitors) {
  const values = (competitors || [])
    .map((c) => c.min_nights)
    .filter((v) => v != null && v > 0);

  if (values.length === 0) return 2;

  // Find mode
  const counts = {};
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1;
  }

  let mode = 2;
  let maxCount = 0;
  for (const [val, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      mode = Number(val);
    }
  }
  return mode;
}

module.exports = { computeTcpn, computeTotalCost, tcpnToNightlyRate, computeReferenceNights };
