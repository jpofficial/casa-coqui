/**
 * Shared unit name helpers.
 *
 * The canonical list of units lives in the Firestore doc `settings/property`
 * under the `units` field.  Every UI and API that needs unit names should call
 * these helpers so that renaming a unit propagates everywhere.
 */

export const DEFAULT_UNITS = [
  { id: 'unit-a', name: 'Unit A' },
  { id: 'unit-b', name: 'Unit B' },
];

/**
 * Return an array of unit name strings from the settings doc.
 * Falls back to DEFAULT_UNITS names when settings.units is not set.
 *
 * @param {object|null} settings — the `settings/property` Firestore doc
 * @returns {string[]}
 */
export function getUnitNames(settings) {
  if (settings?.units && Array.isArray(settings.units) && settings.units.length > 0) {
    return settings.units.map((u) => u.name);
  }
  return DEFAULT_UNITS.map((u) => u.name);
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
