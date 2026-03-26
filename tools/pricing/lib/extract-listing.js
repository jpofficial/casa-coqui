/**
 * Shared Airbnb listing extraction logic.
 *
 * Operates on a raw JSON string (from data-deferred-state) and returns
 * structured listing data. Used by both the HTTP scraper (API route)
 * and the Playwright market-research module.
 *
 * Usage (CJS):
 *   const { extractFromDeferredState, extractFromLdJson, extractFromDescription } = require('./extract-listing');
 *   const data = {};
 *   extractFromDeferredState(jsonObj, data);
 */

/**
 * Walk sections from the niobe presentation path.
 */
function walkSections(sections, data) {
  if (!sections) return;
  const arr = Array.isArray(sections) ? sections : (sections.sections || [sections]);
  for (const sec of arr) {
    const sd = sec?.section?.sectionData || sec?.sectionData || sec;
    if (sd?.title && !data.name) data.name = sd.title;
    if (sd?.overviewItems) {
      for (const item of sd.overviewItems) {
        const text = item?.title || '';
        if (/guest/i.test(text)) {
          const m = text.match(/(\d+)/);
          if (m && data.max_guests == null) data.max_guests = Number(m[1]);
        }
        if (/bedroom/i.test(text)) {
          const m = text.match(/(\d+)/);
          if (m && data.bedrooms == null) data.bedrooms = Number(m[1]);
        }
        if (/bath/i.test(text)) {
          const m = text.match(/([\d.]+)/);
          if (m && data.bathrooms == null) data.bathrooms = Number(m[1]);
        }
      }
    }
  }
}

/**
 * Extract listing data from the data-deferred-state JSON blob.
 * Mutates `data` in-place.
 */
function extractFromDeferredState(json, data) {
  const str = JSON.stringify(json);

  // Try to find listing data in niobeMinimalClientData path
  const niobeKey = Object.keys(json?.niobeMinimalClientData || {}).find(k => k.startsWith('StayListing'));
  const listing = niobeKey
    ? json.niobeMinimalClientData[niobeKey]?.[1]?.data?.presentation?.stayProductDetailPage?.sections
    : null;

  if (listing) {
    walkSections(listing, data);
  }

  // Regex fallbacks on stringified JSON
  if (!data.name) {
    const m = str.match(/"listingTitle"\s*:\s*"([^"]+)"/);
    if (m) data.name = m[1];
  }
  if (!data.name) {
    const m = str.match(/"title"\s*:\s*"([^"]{3,80})"/);
    if (m) data.name = m[1];
  }
  if (data.bedrooms == null) {
    const m = str.match(/"bedrooms"\s*:\s*(\d+)/);
    if (m) data.bedrooms = Number(m[1]);
  }
  if (data.bathrooms == null) {
    const m = str.match(/"bathrooms"\s*:\s*([\d.]+)/);
    if (m) data.bathrooms = Number(m[1]);
  }
  if (data.max_guests == null) {
    const m = str.match(/"personCapacity"\s*:\s*(\d+)/);
    if (m) data.max_guests = Number(m[1]);
  }
  if (data.max_guests == null) {
    const m = str.match(/"maxGuestCapacity"\s*:\s*(\d+)/);
    if (m) data.max_guests = Number(m[1]);
  }
  if (data.rating == null) {
    const m = str.match(/"overallRating"\s*:\s*([\d.]+)/);
    if (m) data.rating = Number(Number(m[1]).toFixed(2));
  }
  if (data.review_count == null) {
    const m = str.match(/"reviewCount"\s*:\s*(\d+)/);
    if (m) data.review_count = Number(m[1]);
  }
  if (data.review_count == null) {
    const m = str.match(/"visibleReviewCount"\s*:\s*(\d+)/);
    if (m) data.review_count = Number(m[1]);
  }
  if (!data.host_name) {
    const m = str.match(/"hostName"\s*:\s*"([^"]+)"/);
    if (m) data.host_name = m[1];
  }
  if (!data.host_name) {
    const m = str.match(/"name"\s*:\s*"([^"]+)"[^}]*"isSuperhost"/);
    if (m) data.host_name = m[1];
  }
  if (data.superhost == null) {
    const m = str.match(/"isSuperhost"\s*:\s*(true|false)/);
    if (m) data.superhost = m[1] === 'true';
  }
  if (!data.neighborhood) {
    const m = str.match(/"neighborhood"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
    if (m) data.neighborhood = m[1];
  }
  if (!data.neighborhood) {
    const m = str.match(/"localizedCity"\s*:\s*"([^"]+)"/);
    if (m) data.neighborhood = m[1];
  }
  if (data.min_nights == null) {
    const m = str.match(/"minNights"\s*:\s*(\d+)/);
    if (m) data.min_nights = Number(m[1]);
  }

  // Base nightly rate
  if (data.base_rate == null) {
    const m = str.match(/"priceString"\s*:\s*"\$(\d+)/);
    if (m) data.base_rate = Number(m[1]);
  }
  if (data.base_rate == null) {
    const m = str.match(/"basePrice"\s*:\s*(\d+)/);
    if (m) data.base_rate = Number(m[1]);
  }
  if (data.base_rate == null) {
    const m = str.match(/"price"\s*:\s*(\d+)/);
    if (m) data.base_rate = Number(m[1]);
  }
  if (data.base_rate == null) {
    const m = str.match(/"discountedPrice"\s*:\s*(\d+)/);
    if (m) data.base_rate = Number(m[1]);
  }
  if (data.base_rate == null) {
    const m = str.match(/"originalPrice"\s*:\s*(\d+)/);
    if (m) data.base_rate = Number(m[1]);
  }
  if (data.base_rate == null) {
    const m = str.match(/"structuredDisplayPrice"[^}]*"amount"\s*:\s*"(\d+)"/);
    if (m) data.base_rate = Number(m[1]);
  }

  // Cleaning fee
  if (data.cleaning_fee == null) {
    const m = str.match(/"cleaningFee"\s*:\s*(\d+)/);
    if (m) data.cleaning_fee = Number(m[1]);
  }
  if (data.cleaning_fee == null) {
    const m = str.match(/"cleaning[Ff]ee[^}]*"amount"\s*:\s*(\d+)/);
    if (m) data.cleaning_fee = Number(m[1]);
  }

  // Amenities
  if (!data.amenities) {
    const amenities = [];
    const re = /"amenityGroups".*?"amenities"\s*:\s*\[(.*?)\]/gs;
    let match;
    while ((match = re.exec(str)) !== null) {
      const names = match[1].match(/"title"\s*:\s*"([^"]+)"/g);
      if (names) {
        for (const n of names) {
          const val = n.match(/"title"\s*:\s*"([^"]+)"/);
          if (val) amenities.push(val[1]);
        }
      }
    }
    if (amenities.length > 0) {
      data.amenities = [...new Set(amenities)].join(', ');
    }
  }
}

/**
 * Extract data from LD+JSON script tags.
 */
function extractFromLdJson(json, data) {
  const items = Array.isArray(json) ? json : [json];
  for (const item of items) {
    if (item['@type'] === 'BedAndBreakfast' || item['@type'] === 'LodgingBusiness' || item['@type'] === 'House' || item['@type'] === 'Apartment' || item.name) {
      if (item.name && !data.name) data.name = item.name;
      if (item.aggregateRating) {
        if (item.aggregateRating.ratingValue && data.rating == null)
          data.rating = Number(Number(item.aggregateRating.ratingValue).toFixed(2));
        if (item.aggregateRating.reviewCount && data.review_count == null)
          data.review_count = Number(item.aggregateRating.reviewCount);
      }
      if (item.address?.addressLocality && !data.neighborhood)
        data.neighborhood = item.address.addressLocality;
    }
  }
}

/**
 * Extract data from freeform description text.
 */
function extractFromDescription(text, data) {
  if (data.bedrooms == null) {
    const m = text.match(/(\d+)\s*bedroom/i);
    if (m) data.bedrooms = Number(m[1]);
  }
  if (data.bathrooms == null) {
    const m = text.match(/([\d.]+)\s*bath/i);
    if (m) data.bathrooms = Number(m[1]);
  }
  if (data.max_guests == null) {
    const m = text.match(/(\d+)\s*guest/i);
    if (m) data.max_guests = Number(m[1]);
  }
}

/**
 * Extract total price and per-night rate from a deferred-state JSON blob
 * that includes pricing breakdown (used when dates are set).
 */
function extractPriceFromJson(json) {
  const str = JSON.stringify(json);
  const result = { total: null, nightly_rate: null, cleaning_fee: null, nights: null };

  // Total price
  const totalMatch = str.match(/"total"\s*:\s*\{[^}]*"amount"\s*:\s*([\d.]+)/);
  if (totalMatch) result.total = Number(totalMatch[1]);

  if (result.total == null) {
    const m = str.match(/"totalPrice"\s*:\s*([\d.]+)/);
    if (m) result.total = Number(m[1]);
  }

  // Nightly rate from price breakdown
  const nightlyMatch = str.match(/"priceItems".*?"amount"\s*:\s*([\d.]+).*?"nights"/s);
  if (nightlyMatch) result.nightly_rate = Number(nightlyMatch[1]);

  if (result.nightly_rate == null) {
    const m = str.match(/"priceString"\s*:\s*"\$(\d+)/);
    if (m) result.nightly_rate = Number(m[1]);
  }
  if (result.nightly_rate == null) {
    const m = str.match(/"basePrice"\s*:\s*(\d+)/);
    if (m) result.nightly_rate = Number(m[1]);
  }

  // Cleaning fee
  const cleanMatch = str.match(/"cleaningFee"\s*:\s*(\d+)/);
  if (cleanMatch) result.cleaning_fee = Number(cleanMatch[1]);

  // Nights
  const nightsMatch = str.match(/"numberOfNights"\s*:\s*(\d+)/);
  if (nightsMatch) result.nights = Number(nightsMatch[1]);

  return result;
}

module.exports = {
  extractFromDeferredState,
  extractFromLdJson,
  extractFromDescription,
  extractPriceFromJson,
  walkSections,
};
