/**
 * Shared unit name helpers.
 *
 * The canonical list of units lives in the Firestore doc `settings/property`
 * under the `units` field.  Every UI and API that needs unit names should call
 * these helpers so that renaming a unit propagates everywhere.
 *
 * Bookings store a stable `unitId` (e.g. "unit-a") so that renames in Settings
 * are immediately reflected on the guest portal without touching booking docs.
 */

export const DEFAULT_UNITS = [
  { id: 'unit-a', name: 'Unit A' },
  { id: 'unit-b', name: 'Unit B' },
];

/**
 * Return the full units array [{id, name}, ...] from settings.
 * Falls back to DEFAULT_UNITS when settings.units is not set.
 *
 * @param {object|null} settings — the `settings/property` Firestore doc
 * @returns {{id: string, name: string}[]}
 */
export function getUnits(settings) {
  if (settings?.units && Array.isArray(settings.units) && settings.units.length > 0) {
    return settings.units;
  }
  return DEFAULT_UNITS;
}

/**
 * Return an array of unit name strings from the settings doc.
 * Falls back to DEFAULT_UNITS names when settings.units is not set.
 *
 * @param {object|null} settings — the `settings/property` Firestore doc
 * @returns {string[]}
 */
export function getUnitNames(settings) {
  return getUnits(settings).map((u) => u.name);
}

/**
 * Return unit names + "Shared" — used for expenses and similar pages.
 *
 * @param {object|null} settings — the `settings/property` Firestore doc
 * @returns {string[]}
 */
export function getUnitsWithShared(settings) {
  return [...getUnitNames(settings), 'Shared'];
}

/**
 * Index-based color palettes for unit display.
 * First unit gets palette[0], second gets palette[1], etc.
 */
export const UNIT_PALETTES = [
  {
    accent: 'bg-teal-500',
    text: 'text-teal-600',
    progressBg: 'bg-teal-100',
    progressFill: 'bg-teal-500',
  },
  {
    accent: 'bg-amber-500',
    text: 'text-amber-600',
    progressBg: 'bg-amber-100',
    progressFill: 'bg-amber-500',
  },
];

const DEFAULT_PALETTE = {
  accent: 'bg-gray-500',
  text: 'text-gray-600',
  progressBg: 'bg-gray-100',
  progressFill: 'bg-gray-500',
};

/**
 * Resolve a booking's unit to the **current** configured display name.
 *
 * Accepts either a booking object or a plain unit string for convenience.
 * When a booking object is passed and contains a `unitId`, that id is looked
 * up directly in settings — so renames propagate instantly.
 *
 * Fallback chain (for old bookings without unitId):
 *   1. Exact name match against current settings
 *   2. Normalized match (strips "Unit " prefix, case-insensitive)
 *   3. DEFAULT_UNITS positional mapping ("Unit A" → index 0 → current name)
 *   4. Raw value as-is
 *
 * @param {string|object|null} bookingOrUnit — booking object {unit, unitId} or raw unit string
 * @param {object|null} settings — the `settings/property` Firestore doc
 * @returns {string|null} the display name, or null when no unit info exists
 */
export function resolveUnitDisplayName(bookingOrUnit, settings) {
  if (!bookingOrUnit) return null;

  const isObject = typeof bookingOrUnit === 'object';
  const unitId = isObject ? bookingOrUnit.unitId : null;
  const rawUnit = isObject ? bookingOrUnit.unit : bookingOrUnit;

  const units = getUnits(settings);

  // Preferred path: look up by stable unitId
  if (unitId) {
    const match = units.find((u) => u.id === unitId);
    if (match) return match.name;
  }

  // No unitId (legacy booking) — fall back to name-based resolution
  if (!rawUnit) return null;
  const unitNames = units.map((u) => u.name);

  // Exact match
  if (unitNames.includes(rawUnit)) return rawUnit;

  // Normalize: strip a leading "Unit " prefix for legacy values like "Unit A"
  const normalized = rawUnit.replace(/^Unit\s*/i, '').trim().toLowerCase();

  const idx = unitNames.findIndex((name) => {
    const nameNorm = name.replace(/^Unit\s*/i, '').trim().toLowerCase();
    return nameNorm === normalized || name.toLowerCase() === rawUnit.toLowerCase();
  });

  if (idx >= 0) return unitNames[idx];

  // Legacy mapping: if rawUnit matches a DEFAULT_UNITS name (e.g. "Unit A"),
  // use its positional index to resolve to the current configured name.
  const defaultIdx = DEFAULT_UNITS.findIndex(
    (d) => d.name.toLowerCase() === rawUnit.toLowerCase()
  );
  if (defaultIdx >= 0 && defaultIdx < unitNames.length) {
    return unitNames[defaultIdx];
  }

  // No match — return the raw value as-is
  return rawUnit;
}

/**
 * Resolve WiFi credentials for a booking based on its unit.
 *
 * Lookup chain:
 *   1. Per-unit WiFi from settings.unitWifi using booking.unitId
 *   2. Global settings.wifiNetwork / settings.wifiPassword
 *   3. Legacy booking-level fields (wifiSsid / wifi.ssid)
 *
 * @param {object|null} booking — booking document (needs unitId)
 * @param {object|null} settings — the `settings/property` Firestore doc
 * @returns {{ ssid: string|null, password: string|null }}
 */
export function resolveUnitWifi(booking, settings) {
  // 1. Try per-unit WiFi
  if (booking?.unitId && Array.isArray(settings?.unitWifi)) {
    const match = settings.unitWifi.find((w) => w.unitId === booking.unitId);
    if (match?.ssid) {
      return { ssid: match.ssid, password: match.password || null };
    }
  }

  // 2. Global settings WiFi
  if (settings?.wifiNetwork) {
    return { ssid: settings.wifiNetwork, password: settings.wifiPassword || null };
  }

  // 3. Legacy booking fields
  const ssid = booking?.wifiSsid || booking?.wifi?.ssid || null;
  const password = booking?.wifiPassword || booking?.wifi?.password || null;
  return { ssid, password };
}

/**
 * Resolve check-in steps for a booking based on its unit.
 *
 * Lookup chain:
 *   1. Per-unit steps from settings.unitCheckInSteps using booking.unitId
 *   2. Flat settings.checkInSteps (legacy/shared)
 *   3. null (caller provides fallback)
 *
 * @param {object|null} booking — booking document (needs unitId)
 * @param {object|null} settings — the `settings/property` Firestore doc
 * @returns {Array|null} array of step objects, or null when nothing found
 */
export function resolveUnitCheckInSteps(booking, settings) {
  // 1. Try per-unit check-in steps
  if (booking?.unitId && Array.isArray(settings?.unitCheckInSteps)) {
    const match = settings.unitCheckInSteps.find((u) => u.unitId === booking.unitId);
    if (match?.steps?.length) {
      return match.steps;
    }
  }

  // 2. Flat/shared check-in steps
  if (settings?.checkInSteps?.length) {
    return settings.checkInSteps;
  }

  // 3. Nothing found
  return null;
}

/**
 * Map from stable unitId to the legacy parkingInfo apartment key.
 * Admin settings stores parking under `parkingInfo.apartmentA` / `apartmentB`.
 */
const UNIT_ID_TO_APT_KEY = { 'unit-a': 'apartmentA', 'unit-b': 'apartmentB' };

/**
 * Resolve per-unit parking data for a booking.
 *
 * The admin settings parking section stores data under legacy positional keys
 * (`apartmentA`, `apartmentB`).  This helper bridges from the booking's
 * `unitId` (or legacy `unit` name) to the correct apartment data.
 *
 * Lookup chain:
 *   1. booking.unitId → positional apartment key
 *   2. booking.unit display name → strip "Unit " prefix → apartment key
 *   3. booking.unit display name → match against current unit names → position
 *   4. null (no parking data for this unit)
 *
 * @param {object|null} booking — booking document
 * @param {object|null} settings — the `settings/property` Firestore doc
 * @returns {{ apartment: object|null, aptKey: string|null, unitIndex: number|null }}
 */
export function resolveUnitParking(booking, settings) {
  const parkingInfo = settings?.parkingInfo;
  if (!parkingInfo) return { apartment: null, aptKey: null, unitIndex: null };

  // 1. Preferred: stable unitId → apartment key
  if (booking?.unitId && UNIT_ID_TO_APT_KEY[booking.unitId]) {
    const aptKey = UNIT_ID_TO_APT_KEY[booking.unitId];
    const idx = booking.unitId === 'unit-a' ? 0 : 1;
    return { apartment: parkingInfo[aptKey] || null, aptKey, unitIndex: idx };
  }

  // 2. Legacy: strip "Unit " prefix and check for A/B
  const rawUnit = booking?.unit ?? null;
  if (rawUnit) {
    const stripped = rawUnit.replace(/^Unit\s*/i, '').trim().toUpperCase();
    if (stripped === 'A') return { apartment: parkingInfo.apartmentA || null, aptKey: 'apartmentA', unitIndex: 0 };
    if (stripped === 'B') return { apartment: parkingInfo.apartmentB || null, aptKey: 'apartmentB', unitIndex: 1 };

    // 3. Match against current unit names to determine position
    const units = getUnits(settings);
    const idx = units.findIndex(
      (u) => u.name === rawUnit || u.name.toLowerCase() === rawUnit.toLowerCase()
    );
    if (idx === 0) return { apartment: parkingInfo.apartmentA || null, aptKey: 'apartmentA', unitIndex: 0 };
    if (idx === 1) return { apartment: parkingInfo.apartmentB || null, aptKey: 'apartmentB', unitIndex: 1 };
  }

  return { apartment: null, aptKey: null, unitIndex: null };
}

/**
 * Get the color palette for a unit by its position in the unit names array.
 *
 * @param {string} unit — the unit name to look up
 * @param {string[]} unitNames — ordered list from getUnitNames()
 * @returns {object} palette with accent, text, progressBg, progressFill
 */
export function getUnitPalette(unit, unitNames) {
  const idx = unitNames.indexOf(unit);
  if (idx >= 0) return UNIT_PALETTES[idx % UNIT_PALETTES.length];
  return DEFAULT_PALETTE;
}
