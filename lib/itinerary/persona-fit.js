/**
 * Determines whether Casa Coqui is a good fit for a given plan.
 * Returns { fit: boolean, reason: string }.
 *
 * Rules:
 * - Casa Coqui has 2 units, each sleeps up to 4 guests (8 total)
 * - Strong fit: couple or family (2-4) on 3-10 day trips, OSJ-focused
 * - Weak fit: large groups (>4 per unit), solo budget travelers, 1-2 day trips
 * - Universal: every plan still gets the "Where to Stay" panel
 */
export function casaCoquiFits(plan) {
  const numDays = plan?.num_days || (plan?.days || []).length || 0;
  const travelerType = plan?.traveler_type;

  if (numDays < 2) return { fit: false, reason: 'short_trip' };
  if (numDays > 14) return { fit: false, reason: 'long_trip' };
  if (travelerType === 'friends') return { fit: true, reason: 'friends_might_fit_split_across_units' };
  if (travelerType === 'family') return { fit: true, reason: 'family_fits' };
  if (travelerType === 'couple') return { fit: true, reason: 'couple_fits' };
  if (travelerType === 'solo') return { fit: false, reason: 'solo_overprovisioned' };
  return { fit: true, reason: 'default_show' };
}
