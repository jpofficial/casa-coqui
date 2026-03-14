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
